import type { WorkItemSummary } from "@/lib/azdoCommands";

// Terminal states never count as stale: a Closed/Done item is intentionally
// untouched. Matches the "done" colouring in WorkItemPreviewDetails.
const TERMINAL_WORK_ITEM_STATES = new Set([
  "done",
  "closed",
  "completed",
  "inactive",
  "removed",
]);

// Days since the item last changed, or null when it is terminal / undated and
// therefore not eligible for a stale alert.
export function workItemStaleDays(
  item: WorkItemSummary,
  nowMs: number,
): number | null {
  if (!item.changedDate) return null;
  if (TERMINAL_WORK_ITEM_STATES.has((item.state ?? "").trim().toLowerCase())) {
    return null;
  }
  const changed = new Date(item.changedDate).getTime();
  if (!Number.isFinite(changed)) return null;
  return Math.floor((nowMs - changed) / 86_400_000);
}

export function isWorkItemStale(
  item: WorkItemSummary,
  thresholdDays: number,
  nowMs: number,
): boolean {
  const days = workItemStaleDays(item, nowMs);
  return days !== null && days >= thresholdDays;
}
