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

export function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

export type AnalyzeBucket = {
  /** `YYYY-MM-DD`: the day itself, or the day that opens the week or month. */
  key: string;
  start: Date;
  /** Exclusive end, so a commit at 23:59 on the last day still lands inside. */
  end: Date;
};

function bucketStart(granularity: AnalyzeGranularity, date: Date): Date {
  if (granularity === "month") return startOfUtcMonth(date);
  if (granularity === "week") return startOfUtcWeek(date);
  return startOfUtcDay(date);
}

/** The bucket that begins `steps` buckets after `start`. */
function stepFrom(granularity: AnalyzeGranularity, start: Date, steps: number): Date {
  if (granularity === "month") return addUtcMonths(start, steps);
  const stepDays = granularity === "week" ? 7 : 1;
  return new Date(start.getTime() + steps * stepDays * DAY_MS);
}

/**
 * Builds `count` buckets ending with the one containing `now`, oldest first.
 */
export function analyzeBuckets(
  granularity: AnalyzeGranularity,
  count: number,
  now: Date = new Date(),
): AnalyzeBucket[] {
  const span = Math.max(1, Math.round(count));
  const last = bucketStart(granularity, now);

  const buckets: AnalyzeBucket[] = [];
  for (let index = span - 1; index >= 0; index -= 1) {
    const start = stepFrom(granularity, last, -index);
    buckets.push({ key: isoDate(start), start, end: stepFrom(granularity, start, 1) });
  }
  return buckets;
}

/**
 * Buckets spanning an explicit `from`..`to` day range, inclusive of both ends.
 *
 * Used by the custom and relative-month presets, where the window is pinned to
 * dates rather than counted back from now.
 */
export function analyzeBucketsBetween(
  granularity: AnalyzeGranularity,
  from: string,
  to: string,
  maxBuckets = 400,
): AnalyzeBucket[] {
  const fromTime = Date.parse(`${from}T00:00:00Z`);
  const toTime = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || toTime < fromTime) return [];

  const buckets: AnalyzeBucket[] = [];
  let start = bucketStart(granularity, new Date(fromTime));
  while (start.getTime() <= toTime && buckets.length < maxBuckets) {
    const end = stepFrom(granularity, start, 1);
    buckets.push({ key: isoDate(start), start, end });
    start = end;
  }
  return buckets;
}

/** First and last day of the month `offset` months back from `now`. */
export function monthRange(offset: number, now: Date = new Date()): { from: string; to: string } {
  const start = addUtcMonths(startOfUtcMonth(now), -offset);
  const end = addUtcMonths(start, 1);
  return { from: isoDate(start), to: isoDate(new Date(end.getTime() - DAY_MS)) };
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
  // Month buckets differ in length, so the arithmetic shortcut does not hold.
  const uniform = buckets.every(
    (bucket) => bucket.end.getTime() - bucket.start.getTime() === stepMs,
  );

  for (const item of items) {
    const raw = dateOf(item);
    if (!raw) continue;
    const time = new Date(raw).getTime();
    if (!Number.isFinite(time) || time < windowStart || time >= windowEnd) continue;
    const bucket = uniform
      ? buckets[Math.floor((time - windowStart) / stepMs)]
      : buckets.find(
          (candidate) => time >= candidate.start.getTime() && time < candidate.end.getTime(),
        );
    if (bucket) grouped.get(bucket.key)?.push(item);
  }
  return grouped;
}

/**
 * Whether a day bucket falls on a Saturday or Sunday. Week and month buckets
 * always span both, so only day granularity can answer this.
 */
export function isWeekendBucket(bucket: AnalyzeBucket): boolean {
  const index = mondayIndex(bucket.start);
  return index === 5 || index === 6;
}

/** Formats a bucket key for display, e.g. `08-05 (Wed)` or `Week of 08-03`. */
export function formatBucketLabel(bucket: AnalyzeBucket, granularity: AnalyzeGranularity): string {
  const month = pad(bucket.start.getUTCMonth() + 1);
  const day = pad(bucket.start.getUTCDate());
  if (granularity === "month") return `${bucket.start.getUTCFullYear()}-${month}`;
  if (granularity === "week") return `Week of ${month}-${day}`;
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][mondayIndex(bucket.start)];
  return `${month}-${day} (${weekday})`;
}
