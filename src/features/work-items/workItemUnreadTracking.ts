// "Unread" markers for work items: a work item that changed since the user
// last opened it is flagged, so new comments / mentions / updates are easy to
// spot. We use System.ChangedDate (already synced) as the activity stamp,
// diffing it against the last value the user acknowledged by opening the item.
// First-seen items establish a baseline (not unread); only later changes mark
// them unread. Tracking is persisted locally so it survives a restart.

import { readStoredJson, storageKey, writeStoredJson } from "@/lib/storage";

const TRACKING_KEY = storageKey("azdodeck:workItems:unreadTracking", 1);

type Tracking = Record<string, { seen: string }>;

function load(): Tracking {
  return readStoredJson<Tracking>(
    TRACKING_KEY,
    (raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
      const result: Tracking = {};
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        const seen = (value as { seen?: unknown })?.seen;
        if (typeof seen === "string") result[key] = { seen };
      }
      return result;
    },
    {},
  );
}

function save(tracking: Tracking): void {
  writeStoredJson(TRACKING_KEY, tracking);
}

export function workItemUnreadKey(organizationId: string, id: number): string {
  return `${organizationId}:${id}`;
}

export type WorkItemActivity = { key: string; changedDate: string | null };

// Reconciles current items against stored "seen" stamps and returns the set of
// keys that are unread (changed since last opened). Side effects: records a
// baseline for newly-seen items and prunes entries for items no longer present.
export function reconcileUnread(items: WorkItemActivity[]): Set<string> {
  const tracking = load();
  const present = new Set<string>();
  const unread = new Set<string>();

  for (const { key, changedDate } of items) {
    present.add(key);
    if (!changedDate) continue;
    const entry = tracking[key];
    if (!entry) {
      // First time we see this item: treat its current state as already seen.
      tracking[key] = { seen: changedDate };
    } else if (changedDate > entry.seen) {
      unread.add(key);
    }
  }

  for (const key of Object.keys(tracking)) {
    if (!present.has(key)) delete tracking[key];
  }
  save(tracking);
  return unread;
}

// Marks an item read up to its current changed date (called when opened).
export function markWorkItemRead(key: string, changedDate: string | null): void {
  if (!changedDate) return;
  const tracking = load();
  tracking[key] = { seen: changedDate };
  save(tracking);
}

// Browser-demo helper: mark an item as having unseen activity by seeding its
// "seen" stamp to an older date. No-op if tracking already exists for the key.
export function seedDemoUnread(key: string, olderSeen: string): void {
  const tracking = load();
  if (tracking[key]) return;
  tracking[key] = { seen: olderSeen };
  save(tracking);
}
