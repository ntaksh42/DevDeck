import type { SnoozedItemSummary } from "@/lib/azdoCommands";
import { demoReviewPullRequests } from "@/lib/demo/prData";
import { demoMyWorkItems } from "@/lib/demo/workItems";

// In-memory snooze store for browser demo mode, keyed by `${itemType}:${itemKey}`
// with the snooze deadline as the value. Auto-revival is not simulated; demo
// snoozes simply hide items until manually unsnoozed.
const demoSnoozes = new Map<string, string>();

export function demoSnoozeStoreKey(itemType: string, itemKey: string): string {
  return `${itemType}:${itemKey}`;
}

export function demoSnoozedKeys(itemType: string): Set<string> {
  const keys = new Set<string>();
  for (const stored of demoSnoozes.keys()) {
    const prefix = `${itemType}:`;
    if (stored.startsWith(prefix)) {
      keys.add(stored.slice(prefix.length));
    }
  }
  return keys;
}

export function demoSnoozeItem(
  itemType: string,
  itemKey: string,
  snoozeUntil: string,
): void {
  demoSnoozes.set(demoSnoozeStoreKey(itemType, itemKey), snoozeUntil);
}

export function demoUnsnoozeItem(itemType: string, itemKey: string): void {
  demoSnoozes.delete(demoSnoozeStoreKey(itemType, itemKey));
}

export function demoListSnoozedItems(itemType: string): SnoozedItemSummary[] {
  const snoozedKeys = demoSnoozedKeys(itemType);
  if (itemType === "pull_request") {
    return demoReviewPullRequests()
      .filter((pr) => snoozedKeys.has(`${pr.repositoryId}:${pr.pullRequestId}`))
      .map((pr) => ({
        itemType,
        itemKey: `${pr.repositoryId}:${pr.pullRequestId}`,
        snoozeUntil:
          demoSnoozes.get(
            demoSnoozeStoreKey(itemType, `${pr.repositoryId}:${pr.pullRequestId}`),
          ) ?? "",
        title: pr.title,
        subtitle: pr.repositoryName,
        webUrl: pr.webUrl,
      }));
  }
  return demoMyWorkItems()
    .filter((item) => snoozedKeys.has(String(item.id)))
    .map((item) => ({
      itemType,
      itemKey: String(item.id),
      snoozeUntil:
        demoSnoozes.get(demoSnoozeStoreKey(itemType, String(item.id))) ?? "",
      title: item.title,
      subtitle: item.state ?? null,
      webUrl: item.webUrl ?? null,
    }));
}
