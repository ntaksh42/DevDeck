import { useQueries } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { listPipelineRuns, type PipelineRunSummary } from "@/lib/azdoCommands";
import { formatDate, formatRelativeDate } from "@/lib/utils";
import { NativeSelect } from "@/components/SearchBar";
import {
  type BoardSort,
  type BoardStatusFilter,
  filterBoardRows,
  isFailedRow,
  isRunningRow,
  loadBoardSort,
  NO_RUN_FILTERS,
  type PipelineRunFilters,
  saveBoardSort,
  sortBoardRows,
} from "./pipelineBoard";
import { PipelineHistorySpark } from "./PipelineHistorySpark";
import { RunBadge, RunningDot } from "./PipelineRunBadge";
import { PipelineRunsGrid, type RunSelection } from "./PipelineRunsGrid";
import { isInProgressStatus, pipelineRunVisual } from "./pipelineStatus";
import {
  pipelineSubscriptionHistoryQueryKey,
  subscriptionKey,
  type PipelineSubscription,
} from "./pipelineSubscriptionsStorage";
import { useElementWidth } from "./useElementWidth";

const ACTIVE_REFRESH_INTERVAL_MS = 15_000;
const IDLE_REFRESH_INTERVAL_MS = 60_000;
// Panel widths at which the optional history cells / extra run columns fit.
const SPARK_MIN_WIDTH = 560;
const WIDE_COLUMNS_MIN_WIDTH = 900;

function formatClock(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(
    new Date(ms),
  );
}

const PILL_BASE =
  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring";

export function PipelineSubscriptionsBoard({
  organizationId,
  subscriptions,
  selectedBuildId,
  filters = NO_RUN_FILTERS,
  approvalCount = 0,
  approvalsOpen = false,
  emptyContent,
  onSelectRun,
  onRemove,
  onToggleApprovals,
}: {
  organizationId: string;
  subscriptions: PipelineSubscription[];
  selectedBuildId: number | null;
  filters?: PipelineRunFilters;
  approvalCount?: number;
  approvalsOpen?: boolean;
  /** Shown instead of the default hint when nothing is watched. */
  emptyContent?: ReactNode;
  onSelectRun: (selection: RunSelection) => void;
  onRemove: (projectId: string, definitionId: number) => void;
  onToggleApprovals?: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [statusFilter, setStatusFilter] = useState<BoardStatusFilter>(null);
  const [sort, setSort] = useState<BoardSort>(() => loadBoardSort());
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null);
  const width = useElementWidth(rootEl);
  // Width 0 means "not measured yet" (first paint, no layout engine): show the
  // history cells but keep the compact columns.
  const showSpark = width === 0 || width >= SPARK_MIN_WIDTH;
  const wideColumns = width >= WIDE_COLUMNS_MIN_WIDTH;

  const branchCriterion = filters.branch.trim() || undefined;
  const resultCriterion = filters.result || undefined;
  const requestedForMe = filters.requestedForMe;

  const orgSubscriptions = useMemo(
    () => subscriptions.filter((sub) => sub.organizationId === organizationId),
    [subscriptions, organizationId],
  );

  // Drop expand state for subscriptions that no longer exist, so re-watching a
  // previously expanded pipeline starts collapsed.
  useEffect(() => {
    const liveKeys = new Set(
      subscriptions.map((sub) => subscriptionKey(sub.organizationId, sub.projectId, sub.definitionId)),
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
      const baseKey = pipelineSubscriptionHistoryQueryKey(organizationId, sub.projectId, sub.definitionId);
      return {
        queryKey:
          branchCriterion || resultCriterion || requestedForMe
            ? [...baseKey, branchCriterion ?? null, resultCriterion ?? null, requestedForMe]
            : baseKey,
        queryFn: () =>
          listPipelineRuns({
            organizationId,
            projectId: sub.projectId,
            definitionId: sub.definitionId,
            branch: branchCriterion,
            result: resultCriterion,
            requestedForMe: requestedForMe || undefined,
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

  // Pair each subscription with its run query (by original index, before any
  // reordering) so the index alignment between orgSubscriptions and queries
  // never breaks.
  const allRows = useMemo(
    () =>
      orgSubscriptions.map((sub, index) => {
        const key = subscriptionKey(sub.organizationId, sub.projectId, sub.definitionId);
        const query = queries[index];
        const runs = query?.data ?? [];
        const latest = runs[0];
        const visual = pipelineRunVisual(latest?.status, latest?.result);
        return { sub, key, query, runs, latest, visual, isRunning: latest != null && visual.tone === "active" };
      }),
    [orgSubscriptions, queries],
  );

  // Header counts use each pipeline's latest run, the same "active" / "error"
  // tones that paint the row badges, so a count always matches visible badges.
  const runningCount = allRows.filter(isRunningRow).length;
  const failedCount = allRows.filter(isFailedRow).length;
  const boardRows = useMemo(
    () => filterBoardRows(sortBoardRows(allRows, sort), statusFilter),
    [allRows, sort, statusFilter],
  );

  const lastUpdated = queries.reduce((latest, query) => Math.max(latest, query.dataUpdatedAt ?? 0), 0);
  const refreshing = queries.some((query) => query.isFetching);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleStatusFilter(next: Exclude<BoardStatusFilter, null>) {
    setStatusFilter((current) => (current === next ? null : next));
  }

  function changeSort(next: BoardSort) {
    setSort(next);
    saveBoardSort(next);
  }

  // focusPrimaryGrid() targets a single [data-primary-grid] element, so the
  // marker must sit on the grid holding the selected run; otherwise returning
  // from the detail panel strands focus on a different pipeline. Prefer the
  // expanded grid that contains the selection, falling back to the first
  // expanded grid when nothing is selected there.
  const primaryGridKey = useMemo(() => {
    const expandedRows = allRows.filter(({ key }) => expanded.has(key));
    if (selectedBuildId != null) {
      const withSelection = expandedRows.find(({ runs }) => runs.some((run) => run.buildId === selectedBuildId));
      if (withSelection) return withSelection.key;
    }
    return expandedRows[0]?.key ?? null;
  }, [allRows, expanded, selectedBuildId]);

  if (orgSubscriptions.length === 0) {
    return (
      emptyContent ?? (
        <div className="flex h-full flex-col items-center justify-center rounded-md border border-dashed border-border bg-card px-6 py-10 text-center">
          <p className="text-sm font-medium">No watched pipelines yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a project and pipeline above, then press <span className="font-medium">Watch</span> to track its
            run history here.
          </p>
        </div>
      )
    );
  }

  return (
    <div
      ref={setRootEl}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="text-base font-semibold">Watched pipelines</h2>
        <span className="text-sm text-muted-foreground">{orgSubscriptions.length}</span>
        {runningCount > 0 || statusFilter === "running" ? (
          <button
            type="button"
            aria-pressed={statusFilter === "running"}
            onClick={() => toggleStatusFilter("running")}
            title={`${runningCount} watched pipeline${runningCount === 1 ? "" : "s"} currently running — click to show only these`}
            className={`${PILL_BASE} bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 ${
              statusFilter === "running" ? "ring-2 ring-blue-500" : ""
            }`}
          >
            <RunningDot />
            {runningCount} running
          </button>
        ) : null}
        {failedCount > 0 || statusFilter === "failed" ? (
          <button
            type="button"
            aria-pressed={statusFilter === "failed"}
            onClick={() => toggleStatusFilter("failed")}
            title={`${failedCount} watched pipeline${failedCount === 1 ? "" : "s"} whose latest run failed — click to show only these`}
            className={`${PILL_BASE} bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 ${
              statusFilter === "failed" ? "ring-2 ring-red-500" : ""
            }`}
          >
            <X className="h-3 w-3" aria-hidden="true" />
            {failedCount} failed
          </button>
        ) : null}
        {approvalCount > 0 && onToggleApprovals ? (
          <button
            type="button"
            aria-pressed={approvalsOpen}
            onClick={onToggleApprovals}
            title="Pending approvals assigned to you in the selected project — click to show or hide them"
            className={`${PILL_BASE} bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 ${
              approvalsOpen ? "ring-2 ring-amber-500" : ""
            }`}
          >
            {approvalCount} {approvalCount === 1 ? "approval" : "approvals"}
          </button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <NativeSelect
            compact
            value={sort}
            onChange={(event) => changeSort(event.target.value as BoardSort)}
            aria-label="Sort pipelines"
          >
            <option value="status">Sort: Status</option>
            <option value="name">Sort: Name</option>
            <option value="lastRun">Sort: Last run</option>
          </NativeSelect>
          <button
            type="button"
            onClick={() => queries.forEach((query) => void query.refetch())}
            title={lastUpdated ? `Updated ${formatClock(lastUpdated)} — click to refresh` : "Refresh runs"}
            aria-label="Refresh runs"
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
            {lastUpdated ? <span className="tabular-nums">{formatClock(lastUpdated)}</span> : null}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {boardRows.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            No watched pipelines match.{" "}
            <button type="button" onClick={() => setStatusFilter(null)} className="text-link hover:underline">
              Clear filter
            </button>
          </div>
        ) : null}
        {boardRows.map(({ sub, key, query, runs, latest, visual, isRunning }) => {
          const isOpen = expanded.has(key);
          return (
            <div key={key} className="border-b border-border last:border-b-0">
              <div
                className={`flex items-center gap-2 border-l-2 px-2 py-1.5 hover:bg-muted/40 ${
                  isRunning ? "border-l-blue-500 bg-blue-50/60 dark:bg-blue-950/30" : "border-l-transparent"
                }`}
              >
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
                  <span className="truncate text-xs text-muted-foreground" title={sub.projectName}>
                    {sub.projectName}
                  </span>
                </button>
                {query?.isFetching ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
                ) : null}
                {showSpark ? (
                  <PipelineHistorySpark
                    runs={runs}
                    onSelect={(cell) => {
                      const run = runs.find((candidate) => candidate.buildId === cell.buildId);
                      if (!run) return;
                      setExpanded((prev) => new Set(prev).add(key));
                      onSelectRun({
                        organizationId: run.organizationId,
                        projectId: run.projectId,
                        definitionId: sub.definitionId,
                        buildId: run.buildId,
                      });
                    }}
                  />
                ) : null}
                {latest?.queueTime ? (
                  <span
                    className="hidden shrink-0 text-xs text-muted-foreground sm:inline"
                    title={formatDate(latest.queueTime)}
                  >
                    {formatRelativeDate(latest.queueTime)}
                  </span>
                ) : null}
                <RunBadge visual={visual} label={latest ? undefined : "No runs"} />
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
                  <div className="px-3 py-2 text-center text-xs text-muted-foreground">Loading runs…</div>
                ) : runs.length === 0 ? (
                  <div className="px-3 py-2 text-center text-xs text-muted-foreground">No runs yet.</div>
                ) : (
                  <PipelineRunsGrid
                    label={`${sub.definitionName} runs`}
                    runs={runs}
                    definitionId={sub.definitionId}
                    selectedBuildId={selectedBuildId}
                    isPrimary={key === primaryGridKey}
                    wide={wideColumns}
                    onSelectRun={onSelectRun}
                  />
                )
              ) : null}
            </div>
          );
        })}
      </div>
      {selectedBuildId != null ? (
        <div className="shrink-0 truncate border-t border-border px-2 py-1 text-xs text-muted-foreground">
          <kbd className="font-mono">↑↓</kbd>/<kbd className="font-mono">J K</kbd> move ·{" "}
          <kbd className="font-mono">Enter</kbd> details · <kbd className="font-mono">Ctrl+Enter</kbd> open in
          browser · in details: <kbd className="font-mono">F</kbd> first failure ·{" "}
          <kbd className="font-mono">R</kbd> re-run · <kbd className="font-mono">X</kbd> cancel
        </div>
      ) : null}
    </div>
  );
}
