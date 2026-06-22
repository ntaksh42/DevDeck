import { readStoredJson, writeStoredJson } from "@/lib/storage";

// A client-side "follow" list of work items the user wants to keep an eye on.
// This is intentionally local-only: Azure DevOps does not expose a public REST
// API to set the server-side follow/subscription, so this watchlist lives in
// the browser/app rather than pretending to drive ADO notifications.
export const WORK_ITEM_FOLLOWS_STORAGE_KEY = "azdodeck:workItems:follows";

// Fired (on window) after the follow set changes so other mounted views can
// re-read it without prop drilling, matching the app's other local stores.
export const WORK_ITEM_FOLLOWS_CHANGED_EVENT = "azdodeck:workItems:follows-changed";

// Identifies a work item across organizations/projects.
export function workItemFollowKey(
  organizationId: string,
  projectId: string,
  workItemId: number,
): string {
  return `${organizationId}:${projectId}:${workItemId}`;
}

export function loadFollowedWorkItems(): Set<string> {
  const keys = readStoredJson<string[]>(
    WORK_ITEM_FOLLOWS_STORAGE_KEY,
    (raw) =>
      Array.isArray(raw) ? raw.filter((value): value is string => typeof value === "string") : undefined,
    [],
  );
  return new Set(keys);
}

export function isWorkItemFollowed(key: string): boolean {
  return loadFollowedWorkItems().has(key);
}

// Adds or removes a key and returns the resulting followed state. Persists and
// notifies other views via a window event.
export function toggleWorkItemFollow(key: string): boolean {
  const followed = loadFollowedWorkItems();
  const nowFollowed = !followed.has(key);
  if (nowFollowed) {
    followed.add(key);
  } else {
    followed.delete(key);
  }
  writeStoredJson(WORK_ITEM_FOLLOWS_STORAGE_KEY, [...followed]);
  window.dispatchEvent(new CustomEvent(WORK_ITEM_FOLLOWS_CHANGED_EVENT));
  return nowFollowed;
}
