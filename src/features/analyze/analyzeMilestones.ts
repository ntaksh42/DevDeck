// Milestone targets: "by this date, get the count to this number".
//
// A query can carry several of them, so the target is a polyline rather than a
// single horizontal threshold. The line starts at the first milestone and holds
// flat after the last one, which keeps it independent of the window the user
// happens to be looking at — changing the range must never move the target.

import { isoDate, type AnalyzeBucket } from "./analyzeDateRange";

export type AnalyzeMilestone = {
  /** `YYYY-MM-DD`, the day the target should be met by. */
  date: string;
  count: number;
};

const DAY_MS = 86_400_000;

export function isValidMilestoneDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time)) return false;
  // Rejects impossible days that Date.parse would roll over (e.g. 02-31).
  return isoDate(new Date(time)) === value;
}

export function normalizeMilestone(value: unknown): AnalyzeMilestone | null {
  if (!value || typeof value !== "object") return null;
  const milestone = value as Partial<AnalyzeMilestone>;
  if (typeof milestone.date !== "string" || !isValidMilestoneDate(milestone.date)) return null;
  const count = Number(milestone.count);
  if (!Number.isFinite(count) || count < 0) return null;
  return { date: milestone.date, count: Math.round(count) };
}

/**
 * Ascending by date, with same-day entries collapsed so the later one wins.
 * Everything downstream can then assume a sorted, deduplicated list.
 */
export function normalizeMilestones(value: unknown): AnalyzeMilestone[] {
  if (!Array.isArray(value)) return [];
  const byDate = new Map<string, number>();
  for (const entry of value) {
    const milestone = normalizeMilestone(entry);
    if (milestone) byDate.set(milestone.date, milestone.count);
  }
  return [...byDate.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Whole days from the epoch, so milestones outside the window still anchor. */
function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

/**
 * The target value on `date`.
 *
 * Returns null before the first milestone: the line has not started yet, and
 * inventing a starting point from the visible data would make the target move
 * whenever the range changed.
 */
export function milestoneTargetOn(
  milestones: AnalyzeMilestone[],
  date: string,
): number | null {
  if (milestones.length === 0) return null;
  const day = dayNumber(date);
  const points = milestones.map((milestone) => ({
    day: dayNumber(milestone.date),
    count: milestone.count,
  }));

  const first = points[0];
  const last = points[points.length - 1];
  if (day < first.day) return null;
  // Held flat after the last milestone: the target became "keep it there".
  if (day >= last.day) return last.count;

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (day >= from.day && day <= to.day) {
      if (to.day === from.day) return to.count;
      const ratio = (day - from.day) / (to.day - from.day);
      return from.count + (to.count - from.count) * ratio;
    }
  }
  return null;
}

/** Target for each bucket, aligned to the bucket list the chart draws. */
export function milestoneTargets(
  milestones: AnalyzeMilestone[],
  buckets: AnalyzeBucket[],
): (number | null)[] {
  return buckets.map((bucket) => milestoneTargetOn(milestones, bucket.key));
}

export type MilestoneStatus =
  | { kind: "met"; actual: number; delta: number }
  | { kind: "missed"; actual: number; delta: number }
  | { kind: "ahead"; actual: number; pace: number }
  | { kind: "behind"; actual: number; pace: number }
  | { kind: "pending" }
  | { kind: "unknown" };

/**
 * How a milestone is doing.
 *
 * A milestone in the past is judged against the actual on that day. One in the
 * future is judged against today's pace, so "behind" means the current value is
 * already above where the line says it should be.
 */
export function milestoneStatus(
  milestone: AnalyzeMilestone,
  milestones: AnalyzeMilestone[],
  buckets: AnalyzeBucket[],
  counts: (number | null)[],
  today: string,
): MilestoneStatus {
  const index = buckets.findIndex((bucket) => bucket.key === milestone.date);
  const isPast = dayNumber(milestone.date) <= dayNumber(today);

  if (isPast) {
    if (index < 0) return { kind: "unknown" };
    const actual = counts[index];
    if (actual === null || actual === undefined) return { kind: "unknown" };
    const delta = actual - milestone.count;
    return delta <= 0
      ? { kind: "met", actual, delta }
      : { kind: "missed", actual, delta };
  }

  const todayIndex = buckets.findIndex((bucket) => bucket.key === today);
  const actual = todayIndex >= 0 ? counts[todayIndex] : null;
  const pace = milestoneTargetOn(milestones, today);
  if (actual === null || actual === undefined || pace === null) return { kind: "pending" };
  return actual <= pace
    ? { kind: "ahead", actual, pace }
    : { kind: "behind", actual, pace };
}

/** Suggests the next milestone: a week on, and a step further down. */
export function suggestNextMilestone(
  milestones: AnalyzeMilestone[],
  fallbackDate: string,
  fallbackCount: number,
): AnalyzeMilestone {
  const last = milestones[milestones.length - 1];
  const baseDay = last ? dayNumber(last.date) + 7 : dayNumber(fallbackDate);
  const count = last ? Math.max(0, last.count - 4) : Math.max(0, fallbackCount);

  const taken = new Set(milestones.map((milestone) => milestone.date));
  let day = baseDay;
  let date = isoDate(new Date(day * DAY_MS));
  while (taken.has(date)) {
    day += 1;
    date = isoDate(new Date(day * DAY_MS));
  }
  return { date, count };
}
