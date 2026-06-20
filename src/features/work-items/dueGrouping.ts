import type { WorkItemSummary } from "@/lib/azdoCommands";

// Due-date buckets for the My Work Items grouping. Ordered most-urgent first so
// the chip bar and any sorted display surface overdue work at the top.
export type DueBucket = "overdue" | "today" | "thisWeek" | "later" | "none";

export const DUE_BUCKET_ORDER: DueBucket[] = [
  "overdue",
  "today",
  "thisWeek",
  "later",
  "none",
];

export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
  overdue: "Overdue",
  today: "Due today",
  thisWeek: "This week",
  later: "Later",
  none: "No date",
};

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Classifies a work item's due date relative to `now` (local time). Items with
// a missing or unparseable due date fall into "none" so they never break the
// grouping.
export function dueBucketOf(
  dueDate: string | null | undefined,
  now: Date = new Date(),
): DueBucket {
  if (!dueDate) return "none";
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return "none";

  const today = startOfDay(now);
  const dueDay = startOfDay(due);
  const dayMs = 86_400_000;
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / dayMs);

  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "today";
  // Remainder of the current week (through the next 7 days, today excluded).
  if (diffDays <= 7) return "thisWeek";
  return "later";
}

// Counts items per bucket over the given set, for the chip badges.
export function dueBucketCounts(
  items: WorkItemSummary[],
  now: Date = new Date(),
): Record<DueBucket, number> {
  const counts: Record<DueBucket, number> = {
    overdue: 0,
    today: 0,
    thisWeek: 0,
    later: 0,
    none: 0,
  };
  for (const item of items) counts[dueBucketOf(item.dueDate, now)] += 1;
  return counts;
}
