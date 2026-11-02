// "Changed since you last viewed" tracking. Azure DevOps has no read/unread
// API, so we remember a fingerprint of each item's observable state the last
// time the user opened it and compare against the freshly synced state. Items
// never opened before are not flagged (there is nothing to compare against).

import { readStoredJson, storageKey, writeStoredJson } from "@/lib/storage";

export const LAST_SEEN_STORAGE_KEY = storageKey("azdodeck:lastSeen", 1);
export const LAST_SEEN_LIMIT = 2000;

type LastSeenEntry = { fingerprint: string; seenAt: string };
type LastSeenStore = Record<string, LastSeenEntry>;

function load(): LastSeenStore {
  return readStoredJson<LastSeenStore>(
    LAST_SEEN_STORAGE_KEY,
    (raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
      const result: LastSeenStore = {};
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!value || typeof value !== "object") continue;
        const entry = value as Record<string, unknown>;
        if (typeof entry.fingerprint !== "string" || typeof entry.seenAt !== "string") continue;
        result[key] = { fingerprint: entry.fingerprint, seenAt: entry.seenAt };
      }
      return result;
    },
    {},
  );
}

/** Fingerprint of the fields whose change should count as an update. */
export function fingerprintOf(...parts: Array<string | number | boolean | null | undefined>): string {
  return parts.map((part) => String(part ?? "")).join("\u001f");
}

/** Records the current state of `key` as seen. Keeps only the newest entries. */
export function markSeen(key: string, fingerprint: string, now: Date = new Date()): void {
  const store = load();
  if (store[key]?.fingerprint === fingerprint) return;
  store[key] = { fingerprint, seenAt: now.toISOString() };
  const keys = Object.keys(store);
  if (keys.length > LAST_SEEN_LIMIT) {
    keys
      .sort((a, b) => store[a].seenAt.localeCompare(store[b].seenAt))
      .slice(0, keys.length - LAST_SEEN_LIMIT)
      .forEach((stale) => delete store[stale]);
  }
  writeStoredJson(LAST_SEEN_STORAGE_KEY, store);
}

/** Keys whose current fingerprint differs from the one recorded when last viewed. */
export function changedSince(items: ReadonlyArray<{ key: string; fingerprint: string }>): Set<string> {
  const store = load();
  const changed = new Set<string>();
  for (const { key, fingerprint } of items) {
    const entry = store[key];
    if (entry && entry.fingerprint !== fingerprint) changed.add(key);
  }
  return changed;
}
