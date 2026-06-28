import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Loader2, RefreshCw } from 'lucide-react';
import {
  commandErrorMessage,
  listSyncStates,
  triggerSync,
  type Organization,
  type SyncScope,
  type SyncState,
} from '@/lib/azdoCommands';

export function SyncHealthSettings({ organizations }: { organizations: Organization[] }) {
  const queryClient = useQueryClient();
  const statesQuery = useQuery({
    queryKey: ["syncStates"],
    queryFn: listSyncStates,
    staleTime: 30_000,
  });
  const syncMutation = useMutation({
    mutationFn: triggerSync,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["syncStates"] });
    },
  });

  const states = statesQuery.data ?? [];
  const orgNames = new Map(organizations.map((org) => [org.id, org.name]));

  function syncScope(state: SyncState): SyncScope {
    if (state.scope.startsWith("prs:")) return "myReviews";
    if (state.scope.startsWith("work_items:")) return "myWorkItems";
    if (state.scope.startsWith("commits:")) return "commits";
    return "all";
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Activity className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Sync health</h2>
            <p className="text-sm text-muted-foreground">
              Last successful background sync by cache scope.
            </p>
          </div>
        </div>
      </div>

      <div className="p-3">
        {statesQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading sync state
          </div>
        ) : statesQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(statesQuery.error)}
          </p>
        ) : states.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">No sync has completed yet.</span>
            <button
              type="button"
              disabled={syncMutation.isPending}
              onClick={() => syncMutation.mutate({ scope: "all" })}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {syncMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Sync all
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
            {states.map((state) => {
              const hasError = state.errorCount > 0;
              const hasWarning = !hasError && Boolean(state.lastWarning);
              return (
                <div
                  key={state.scope}
                  className="grid gap-3 bg-card px-3 py-2 text-sm md:grid-cols-[1fr_140px_100px_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{formatSyncScope(state.scope)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {orgNames.get(state.orgId) ?? state.orgId}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Last success</p>
                    <p className="font-medium">{formatSyncTime(state.lastSyncedAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <p
                      className={
                        hasError
                          ? "font-medium text-destructive"
                          : hasWarning
                            ? "font-medium text-amber-700 dark:text-amber-400"
                            : "font-medium text-green-700 dark:text-green-400"
                      }
                    >
                      {hasError ? `${state.errorCount} failed` : hasWarning ? "Limited" : "Healthy"}
                    </p>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    {state.lastError ? (
                      <span
                        className="max-w-52 truncate text-xs text-destructive"
                        title={state.lastError}
                      >
                        {state.lastError}
                      </span>
                    ) : null}
                    {!state.lastError && state.lastWarning ? (
                      <span
                        className="max-w-52 truncate text-xs text-amber-700 dark:text-amber-400"
                        title={state.lastWarning}
                      >
                        {state.lastWarning}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      disabled={syncMutation.isPending}
                      onClick={() => syncMutation.mutate({ scope: syncScope(state) })}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${syncMutation.isPending ? "animate-spin" : ""}`}
                        aria-hidden="true"
                      />
                      Refresh
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {syncMutation.isError ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {commandErrorMessage(syncMutation.error)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function formatSyncScope(scope: string): string {
  if (scope.startsWith("prs:")) return "Pull requests / My Reviews";
  if (scope.startsWith("work_items:")) return "Work items / My Items";
  if (scope.startsWith("commits:")) return "Commits";
  return scope;
}

function formatSyncTime(value: string | null): string {
  if (!value) return "Never";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return new Date(value).toLocaleString();
}
