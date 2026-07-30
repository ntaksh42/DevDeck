import { Loader2, Pin, TriangleAlert } from 'lucide-react';
import { commandErrorMessage } from '@/lib/azdoCommands';
import { viewCountBaseline, type WorkItemQueryView } from './workItemViewsStorage';
import { viewCountHistory } from './workItemViewsDisplayStorage';
import { ViewCountSparkline } from './ViewCountSparkline';

export type ViewCountQueryResult = {
  data?: number;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
};

/** Per-view values derived from its count query, shared by both card modes. */
export type ViewCardStats = {
  displayCount: string | number;
  delta: number | null;
  alerting: boolean;
  history: number[];
};

export function viewCardStats(
  view: WorkItemQueryView,
  query: ViewCountQueryResult | undefined,
): ViewCardStats {
  const count = query?.data ?? 0;
  // An unbounded view reports its exact count, so there is no overflow marker.
  const overflow =
    view.limit !== undefined && typeof query?.data === "number" && query.data > view.limit;
  const baseline = viewCountBaseline(view.id);
  return {
    displayCount: overflow ? `${view.limit}+` : count,
    delta:
      typeof query?.data === "number" && baseline !== null ? query.data - baseline : null,
    alerting:
      typeof view.alertThreshold === "number" &&
      typeof query?.data === "number" &&
      query.data >= view.alertThreshold,
    history: viewCountHistory(view.id),
  };
}

function selectionClasses(selected: boolean, alerting: boolean): string {
  if (alerting) {
    return selected
      ? "border-destructive bg-secondary"
      : "border-destructive bg-destructive/5 hover:bg-destructive/10";
  }
  return selected
    ? "border-primary bg-secondary"
    : "border-border bg-card hover:bg-muted/60";
}

const OPTION_KEY_SHORTCUTS = "ArrowUp ArrowDown ArrowLeft ArrowRight Home End Delete N E R";

type ViewItemProps = {
  view: WorkItemQueryView;
  query: ViewCountQueryResult | undefined;
  stats: ViewCardStats;
  selected: boolean;
  buttonRef: (element: HTMLButtonElement | null) => void;
  onSelect: () => void;
  onEdit: () => void;
};

export function ViewCard({
  view,
  query,
  stats,
  selected,
  buttonRef,
  onSelect,
  onEdit,
}: ViewItemProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="option"
      aria-selected={selected}
      aria-keyshortcuts={OPTION_KEY_SHORTCUTS}
      onClick={onSelect}
      onDoubleClick={onEdit}
      className={`min-h-[88px] rounded-md border p-3 text-left outline-none transition-colors focus:ring-2 focus:ring-inset focus:ring-ring ${selectionClasses(
        selected,
        stats.alerting,
      )}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold" title={view.name}>
          {view.name}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {view.pinned ? <Pin className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> : null}
          {query?.isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : null}
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span
          className={`text-3xl font-semibold leading-none ${stats.alerting ? "text-destructive" : ""}`}
        >
          {query?.isError ? "!" : stats.displayCount}
        </span>
        {stats.delta !== null && stats.delta !== 0 && !query?.isError ? (
          <span
            className="text-xs font-medium text-muted-foreground"
            title="Change since the previous session"
          >
            {stats.delta > 0 ? `+${stats.delta}` : stats.delta}
          </span>
        ) : null}
      </div>
      {query?.isError ? null : <ViewCountSparkline points={stats.history} viewName={view.name} />}
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {query?.isError
          ? commandErrorMessage(query.error)
          : view.limit !== undefined
            ? `${view.limit} max results`
            : "no result limit"}
      </p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground/80">
        {(view.sortKey ?? "changedDate")} {(view.sortDirection ?? "desc").toUpperCase()}
        {view.previewVisible === false ? " · preview off" : ""}
        {view.refreshIntervalSec ? ` · auto ${view.refreshIntervalSec}s` : ""}
        {view.alertThreshold !== undefined ? ` · alert ≥${view.alertThreshold}` : ""}
      </p>
    </button>
  );
}

export function ViewCompactRow({
  view,
  query,
  stats,
  selected,
  buttonRef,
  onSelect,
  onEdit,
}: ViewItemProps) {
  const metaTitle = [
    `${view.sortKey ?? "changedDate"} ${(view.sortDirection ?? "desc").toUpperCase()}`,
    view.limit !== undefined ? `${view.limit} max results` : "no result limit",
    view.refreshIntervalSec ? `auto ${view.refreshIntervalSec}s` : null,
    view.alertThreshold !== undefined ? `alert ≥${view.alertThreshold}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      ref={buttonRef}
      type="button"
      role="option"
      aria-selected={selected}
      aria-keyshortcuts={OPTION_KEY_SHORTCUTS}
      onClick={onSelect}
      onDoubleClick={onEdit}
      title={metaTitle}
      className={`grid grid-cols-[14px_1fr_auto_auto] items-center gap-2 rounded border px-2 py-1 text-left outline-none transition-colors focus:ring-2 focus:ring-inset focus:ring-ring ${selectionClasses(
        selected,
        stats.alerting,
      )}`}
    >
      <span className="flex h-3.5 w-3.5 items-center justify-center">
        {query?.isFetching ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : stats.alerting ? (
          <TriangleAlert className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
        ) : view.pinned ? (
          <Pin className="h-3 w-3 text-primary" aria-hidden="true" />
        ) : null}
      </span>
      <span className="min-w-0 truncate text-xs font-medium" title={view.name}>
        {view.name}
      </span>
      <span
        className={`text-xs font-semibold tabular-nums ${stats.alerting ? "text-destructive" : ""}`}
      >
        {query?.isError ? "!" : stats.displayCount}
      </span>
      <span className="w-8 text-right text-[10px] tabular-nums text-muted-foreground">
        {stats.delta !== null && stats.delta !== 0 && !query?.isError
          ? stats.delta > 0
            ? `+${stats.delta}`
            : stats.delta
          : ""}
      </span>
    </button>
  );
}
