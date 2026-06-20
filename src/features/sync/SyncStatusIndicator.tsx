import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { listSyncStates, type SyncState } from "@/lib/azdoCommands";
import { formatRelativeDate } from "@/lib/utils";

export type SyncStatusSummary = {
  lastSyncedAt: string | null;
  status: "none" | "ok" | "failed" | "reauth";
  errorMessage: string | null;
};

// Heuristic for telling "needs re-authentication" apart from a generic failure
// so the header can prompt the right recovery (re-auth vs. retry).
const AUTH_ERROR_PATTERN = /401|unauthor|authenticat|sign[\s-]?in|reauth|access token/i;

export function summarizeSyncStates(states: SyncState[]): SyncStatusSummary {
  let lastSyncedAt: string | null = null;
  for (const state of states) {
    if (state.lastSyncedAt && (!lastSyncedAt || state.lastSyncedAt > lastSyncedAt)) {
      lastSyncedAt = state.lastSyncedAt;
    }
  }
  const errored = states.filter((state) => state.errorCount > 0 && state.lastError);
  if (errored.length === 0) {
    return { lastSyncedAt, status: lastSyncedAt ? "ok" : "none", errorMessage: null };
  }
  const reauth = errored.find(
    (state) => state.lastError && AUTH_ERROR_PATTERN.test(state.lastError),
  );
  if (reauth) {
    return { lastSyncedAt, status: "reauth", errorMessage: reauth.lastError };
  }
  return { lastSyncedAt, status: "failed", errorMessage: errored[0].lastError };
}

// Compact header indicator: last successful background sync, plus a warning when
// the most recent sync failed (distinguishing re-auth from a generic error).
// Clicking re-runs a full sync.
export function SyncStatusIndicator({
  onSync,
  syncing,
}: {
  onSync: () => void;
  syncing: boolean;
}) {
  const statesQuery = useQuery({
    queryKey: ["syncStates"],
    queryFn: listSyncStates,
    staleTime: 30_000,
    // Keep the relative "Synced Nm ago" label fresh for background syncs.
    refetchInterval: 60_000,
  });
  const summary = useMemo(
    () => summarizeSyncStates(statesQuery.data ?? []),
    [statesQuery.data],
  );

  const isProblem = summary.status === "failed" || summary.status === "reauth";
  const label = syncing
    ? "Syncing…"
    : summary.status === "reauth"
      ? "Reauth required"
      : summary.status === "failed"
        ? "Sync failed"
        : summary.status === "ok" && summary.lastSyncedAt
          ? `Synced ${formatRelativeDate(summary.lastSyncedAt)}`
          : "Not synced yet";

  const title =
    isProblem && summary.errorMessage
      ? `${summary.errorMessage} — click to sync now`
      : "Last background sync — click to sync now";

  return (
    <button
      type="button"
      onClick={onSync}
      disabled={syncing}
      title={title}
      aria-label={label}
      className={`hidden items-center gap-1 rounded-md px-1.5 py-1 text-xs hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 sm:flex ${
        isProblem ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground"
      }`}
    >
      {isProblem ? (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <RefreshCw
          className={`h-3.5 w-3.5 shrink-0 ${syncing ? "animate-spin" : ""}`}
          aria-hidden="true"
        />
      )}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}
