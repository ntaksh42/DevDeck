// Bucket boundaries shared by both halves of the analyze view: the instants a
// query's history is sampled at, and the day/week buckets commits fall into.
//
// Everything is computed in UTC and weeks start on Monday, matching
// CommitActivityHeatmap so the two views never disagree about which day a
// commit belongs to.

import type { AnalyzeGranularity } from "./analyzeGroupsStorage";

const DAY_MS = 86_400_000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function isoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Monday = 0 ... Sunday = 6. */
export function mondayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

export function startOfUtcWeek(date: Date): Date {
  const start = startOfUtcDay(date);
  start.setUTCDate(start.getUTCDate() - mondayIndex(start));
  return start;
}

export type AnalyzeBucket = {
  /** `YYYY-MM-DD`: the day itself, or the Monday that opens the week. */
  key: string;
  start: Date;
  /** Exclusive end, so a commit at 23:59 on the last day still lands inside. */
  end: Date;
};

/**
 * Builds `count` buckets ending with the one containing `now`, oldest first.
 */
export function analyzeBuckets(
  granularity: AnalyzeGranularity,
  count: number,
  now: Date = new Date(),
): AnalyzeBucket[] {
  const span = Math.max(1, Math.round(count));
  const stepDays = granularity === "week" ? 7 : 1;
  const last = granularity === "week" ? startOfUtcWeek(now) : startOfUtcDay(now);

  const buckets: AnalyzeBucket[] = [];
  for (let index = span - 1; index >= 0; index -= 1) {
    const start = new Date(last.getTime() - index * stepDays * DAY_MS);
    const end = new Date(start.getTime() + stepDays * DAY_MS);
    buckets.push({ key: isoDate(start), start, end });
  }
  return buckets;
}

/**
 * Instants to sample a query's history at, one per bucket.
 *
 * A bucket is sampled at the moment it closes rather than when it opens, so a
 * point reflects the state at the end of that day or week. The bucket in
 * progress is sampled at `now` instead of a future instant, which Azure DevOps
 * would reject.
 */
export function analyzeSampleTimestamps(
  buckets: AnalyzeBucket[],
  now: Date = new Date(),
): string[] {
  return buckets.map((bucket) => {
    const boundary = bucket.end.getTime() <= now.getTime() ? bucket.end : now;
    return new Date(boundary).toISOString().replace(/\.\d{3}Z$/, "Z");
  });
}

/** Start of the window covered by `buckets`, as a date-only string. */
export function bucketRangeStart(buckets: AnalyzeBucket[]): string {
  const first = buckets[0];
  return first ? isoDate(first.start) : "";
}

/** Inclusive last day covered by `buckets`, as a date-only string. */
export function bucketRangeEnd(buckets: AnalyzeBucket[]): string {
  const last = buckets[buckets.length - 1];
  return last ? isoDate(new Date(last.end.getTime() - DAY_MS)) : "";
}

/**
 * Assigns each item to its bucket key. Items outside the window are dropped,
 * which keeps a commit from a wider API response out of the first bucket.
 */
export function groupByBucket<T>(
  items: T[],
  buckets: AnalyzeBucket[],
  dateOf: (item: T) => string | null | undefined,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const bucket of buckets) grouped.set(bucket.key, []);
  if (buckets.length === 0) return grouped;

  const windowStart = buckets[0].start.getTime();
  const windowEnd = buckets[buckets.length - 1].end.getTime();
  const stepMs = (buckets[0].end.getTime() - buckets[0].start.getTime()) || DAY_MS;

  for (const item of items) {
    const raw = dateOf(item);
    if (!raw) continue;
    const time = new Date(raw).getTime();
    if (!Number.isFinite(time) || time < windowStart || time >= windowEnd) continue;
    const index = Math.floor((time - windowStart) / stepMs);
    const bucket = buckets[index];
    if (bucket) grouped.get(bucket.key)?.push(item);
  }
  return grouped;
}

/** Formats a bucket key for display, e.g. `08-05 (Wed)` or `Week of 08-03`. */
export function formatBucketLabel(bucket: AnalyzeBucket, granularity: AnalyzeGranularity): string {
  const month = pad(bucket.start.getUTCMonth() + 1);
  const day = pad(bucket.start.getUTCDate());
  if (granularity === "week") return `Week of ${month}-${day}`;
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][mondayIndex(bucket.start)];
  return `${month}-${day} (${weekday})`;
}
