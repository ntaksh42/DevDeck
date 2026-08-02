import { readStoredJson, writeStoredJson } from "@/lib/storage";

export const USAGE_STATS_STORAGE_KEY = "azdodeck:experimental:usageStats";
export const USAGE_STATS_CHANGED_EVENT = "azdodeck:usage-stats-changed";

export type UsageStatKind = "votes" | "resolvedThreads" | "stateChanges";

export type UsageStats = Record<UsageStatKind, number>;

const EMPTY: UsageStats = {
  votes: 0,
  resolvedThreads: 0,
  stateChanges: 0,
};

function count(raw: Record<string, unknown>, key: UsageStatKind): number {
  const value = raw[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

export function loadUsageStats(): UsageStats {
  return readStoredJson(
    USAGE_STATS_STORAGE_KEY,
    (raw) => {
      if (typeof raw !== "object" || raw === null) return undefined;
      const record = raw as Record<string, unknown>;
      return {
        votes: count(record, "votes"),
        resolvedThreads: count(record, "resolvedThreads"),
        stateChanges: count(record, "stateChanges"),
      };
    },
    EMPTY,
  );
}

/**
 * Increments a counter. `enabled` is the resolved experimental flag: when it is
 * off nothing is written, so turning the experiment on always starts from a
 * clean slate rather than revealing counts gathered while it was off.
 */
export function recordUsage(
  kind: UsageStatKind,
  enabled: boolean,
  amount = 1,
): void {
  if (!enabled || amount <= 0) {
    return;
  }
  const current = loadUsageStats();
  writeStoredJson(USAGE_STATS_STORAGE_KEY, {
    ...current,
    [kind]: current[kind] + amount,
  });
  window.dispatchEvent(new Event(USAGE_STATS_CHANGED_EVENT));
}

export function resetUsageStats(): void {
  writeStoredJson(USAGE_STATS_STORAGE_KEY, EMPTY);
  window.dispatchEvent(new Event(USAGE_STATS_CHANGED_EVENT));
}
