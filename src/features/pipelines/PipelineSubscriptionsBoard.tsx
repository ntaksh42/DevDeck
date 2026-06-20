import { useQueries } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ExternalLink, Loader2, X } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useState } from "react";
import { listPipelineRuns, type PipelineRunSummary } from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { formatDate, formatRelativeDate } from "@/lib/utils";
import {
  formatDuration,
  isInProgressStatus,
  pipelineRunVisual,
  runToneClasses,
  shortBranch,
} from "./pipelineStatus";
import { subscriptionKey, type PipelineSubscription } from "./pipelineSubscriptionsStorage";

const ACTIVE_REFRESH_INTERVAL_MS = 15_000;
const IDLE_REFRESH_INTERVAL_MS = 60_000;

type RunSelection = {
  organizationId: string;
  projectId: string;
  definitionId: number;
  buildId: number;
};

export function PipelineSubscriptionsBoard({
  organizationId,
  subscriptions,
  selectedBuildId,
  onSelectRun,
  onRemove,
}: {
  organizationId: string;
  subscriptions: PipelineSubscription[];
  selectedBuildId: number | null;
  onSelectRun: (selection: RunSelection) => void;
  onRemove: (projectId: string, definitionId: number) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const orgSubscriptions = useMemo(
    () => subscriptions.filter((sub) => sub.organizationId === organizationId),
    [subscriptions, organizationId],
  );

  // Drop expand state for subscriptions that no longer exist, so re-watching a
  // previously expanded pipeline starts collapsed.
  useEffect(() => {
    const liveKeys = new Set(
      subscriptions.map((sub) =>
        subscriptionKey(sub.organizationId, sub.projectId, sub.definitionId),
      ),
    );
    setExpanded((prev) => {
      const next = new Set([...prev].filter((key) => liveKeys.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [subscriptions]);

  // One runs query per subscription. Collapsed pipelines keep polling so the
  // header badge stays current, but only at the idle interval; the fast active
  // interval is reserved for expanded (visible) pipelines with a live run, so
  // watching many pipelines does not flood the API with short-interval polls.
  const queries = useQueries({
    queries: orgSubscriptions.map((sub) => {
      const key = subscriptionKey(sub.organizationId, sub.projectId, sub.definitionId);
      const isOpen = expanded.has(key);
      return {
        queryKey: [
          "pipelineSubscriptionHistory",
          organizationId,
          sub.projectId,
          sub.definitionId,
        ],
        queryFn: () =>
          listPipelineRuns({
            organizationId,
            projectId: sub.projectId,
            definitionId: sub.definitionId,
          }),
        enabled: !!organizationId,
        refetchInterval: (query: { state: { data?: PipelineRunSummary[] } }) => {
          if (!isOpen) return IDLE_REFRESH_INTERVAL_MS;
          const data = query.state.data;
          return data?.some((run) => isInProgressStatus(run.status))
            ? ACTIVE_REFRESH_INTERVAL_MS
            : IDLE_REFRESH_INTERVAL_MS;
        },
      };
    }),
  });

  if (orgSubscriptions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-md border border-dashed border-border bg-card px-6 py-10 text-center">
        <p className="text-sm font-medium">No watched pipelines yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a project and pipeline above, then press <span className="font-medium">Watch</span>{" "}
          to track its run history here.
        </p>
      </div>
    );
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Arrow / j-k navigation across the run rows of one expanded pipeline.
  function handleRunKeyDown(
    event: ReactKeyboardEvent,
    rows: PipelineRunSummary[],
    definitionId: number,
  ) {
    // Ignore the Open button and any modified chords.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement;
    const rowEl = target.closest('[role="row"]') as HTMLElement | null;
    if (!rowEl) return;
    const grid = event.currentTarget as HTMLElement;
    const rowEls = Array.from(grid.querySelectorAll<HTMLElement>('[role="row"]'));
    const current = rowEls.indexOf(rowEl);
    const key = event.key.toLowerCase();

    let nextIndex = current;
    if (event.key === "ArrowDown" || key === "j") {
      nextIndex = Math.min(current + 1, rowEls.length - 1);
    } else if (event.key === "ArrowUp" || key === "k") {
      nextIndex = Math.max(current - 1, 0);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = rowEls.length - 1;
    } else if (event.key === "Enter" && current >= 0) {
      event.preventDefault();
      event.stopPropagation();
      const run = rows[current];
      onSelectRun({
        organizationId: run.organizationId,
        projectId: run.projectId,
        definitionId,
        buildId: run.buildId,
      });
      return;
    } else {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    rowEls[nextIndex]?.focus();
  }

  // focusPrimaryGrid() targets a single [data-primary-grid] element, so the
  // marker must sit on the grid holding the selected run; otherwise returning
  // from the detail panel strands focus on a different pipeline. Prefer the
  // expanded grid that contains the selection, falling back to the first
  // expanded grid when nothing is selected there.
  const primaryGridKey = useMemo(() => {
    const expandedSubs = orgSubscriptions
      .map((sub, index) => ({
        key: subscriptionKey(sub.organizationId, sub.projectId, sub.definitionId),
        runs: queries[index]?.data ?? [],
      }))
      .filter(({ key }) => expanded.has(key));
    if (selectedBuildId != null) {
      const withSelection = expandedSubs.find(({ runs }) =>
        runs.some((run) => run.buildId === selectedBuildId),
      );
      if (withSelection) return withSelection.key;
    }
    return expandedSubs[0]?.key ?? null;
  }, [orgSubscriptions, queries, expanded, selectedBuildId]);

  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="text-base font-semibold">Watched pipelines</h2>
        <span className="text-sm text-muted-foreground">
          {orgSubscriptions.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {orgSubscriptions.map((sub, index) => {
          const key = subscriptionKey(sub.organizationId, sub.projectId, sub.definitionId);
          const query = queries[index];
          const runs = query?.data ?? [];
          const latest = runs[0];
          const visual = pipelineRunVisual(latest?.status, latest?.result);
          const isOpen = expanded.has(key);
          // Roving tabindex: the selected run is the Tab entry point, falling
          // back to the first row when the selection is in another pipeline.
          const selectedRunIndex = runs.findIndex((run) => run.buildId === selectedBuildId);
          const tabbableRunIndex = selectedRunIndex >= 0 ? selectedRunIndex : 0;
          return (
            <div key={key} className="border-b border-border last:border-b-0">
              <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/40">
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  aria-expanded={isOpen}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="truncate text-sm font-medium" title={sub.definitionName}>
                    {sub.definitionName}
                  </span>
                  <span
                    className="truncate text-xs text-muted-foreground"
                    title={sub.projectName}
                  >
                    {sub.projectName}
                  </span>
                </button>
                {query?.isFetching ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
                ) : null}
                {latest?.queueTime ? (
                  <span
                    className="hidden shrink-0 text-xs text-muted-foreground sm:inline"
                    title={formatDate(latest.queueTime)}
                  >
                    {formatRelativeDate(latest.queueTime)}
                  </span>
                ) : null}
                <span
                  className={`inline-flex shrink-0 items-center rounded px-1.5 py-px text-xs font-medium ${runToneClasses(
                    visual.tone,
                  )}`}
                >
                  {latest ? visual.label : "No runs"}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(sub.projectId, sub.definitionId)}
                  title="Remove from watched pipelines"
                  aria-label={`Remove ${sub.definitionName} from watched pipelines`}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              {isOpen ? (
                query?.isLoading ? (
                  <div className="px-3 py-2 text-center text-xs text-muted-foreground">
                    Loading runs…
                  </div>
                ) : runs.length === 0 ? (
                  <div className="px-3 py-2 text-center text-xs text-muted-foreground">
                    No runs yet.
                  </div>
                ) : (
                  <div
                    role="grid"
                    aria-label={`${sub.definitionName} runs`}
                    data-primary-grid={key === primaryGridKey ? "true" : undefined}
                    className="overflow-x-auto bg-muted/20 pl-6 outline-none"
                    onKeyDown={(event) => handleRunKeyDown(event, runs, sub.definitionId)}
                  >
                    <div className="min-w-[660px]">
                      {runs.map((run, runIndex) => {
                        const runVisual = pipelineRunVisual(run.status, run.result);
                        const selected = run.buildId === selectedBuildId;
                        return (
                          <div
                            key={run.buildId}
                            role="row"
                            tabIndex={runIndex === tabbableRunIndex ? 0 : -1}
                            aria-selected={selected}
                            onClick={() =>
                              onSelectRun({
                                organizationId: run.organizationId,
                                projectId: run.projectId,
                                definitionId: sub.definitionId,
                                buildId: run.buildId,
                              })
                            }
                            className={`grid h-[28px] w-full cursor-pointer select-none grid-cols-[96px_110px_minmax(120px,1fr)_120px_80px_36px] items-center gap-2 border-b border-border/60 px-2 text-left text-sm outline-none last:border-b-0 focus:ring-2 focus:ring-inset focus:ring-ring ${
                              selected ? "bg-secondary" : "hover:bg-muted/50"
                            }`}
                          >
                            <span
                              className={`inline-flex w-fit items-center rounded px-1.5 py-px text-xs font-medium ${runToneClasses(
                                runVisual.tone,
                              )}`}
                            >
                              {runVisual.label}
                            </span>
                            <span className="truncate font-mono text-xs text-muted-foreground">
                              {run.buildNumber ?? run.buildId}
                            </span>
                            <span
                              className="truncate text-xs text-muted-foreground"
                              title={run.sourceBranch ?? undefined}
                            >
                              {shortBranch(run.sourceBranch)}
                            </span>
                            <span
                              className="truncate text-xs text-muted-foreground"
                              title={run.queueTime ? formatDate(run.queueTime) : undefined}
                            >
                              {run.queueTime ? formatRelativeDate(run.queueTime) : "—"}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              {formatDuration(run.startTime, run.finishTime)}
                            </span>
                            <button
                              type="button"
                              disabled={!run.webUrl}
                              onClick={(event) => {
                                event.stopPropagation();
                                void openExternalUrl(run.webUrl).catch(() => {});
                              }}
                              title="Open run in browser"
                              aria-label={`Open run ${run.buildNumber ?? run.buildId} in browser`}
                              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                            >
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
