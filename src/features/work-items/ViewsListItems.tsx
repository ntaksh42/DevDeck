import { GripVertical, Loader2, Pin, TriangleAlert } from 'lucide-react';
import { commandErrorMessage } from '@/lib/azdoCommands';
import type { ColumnDragProps } from '@/lib/columnDrag';
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

const OPTION_KEY_SHORTCUTS = "ArrowUp ArrowDown ArrowLeft ArrowRight Home End Delete N E R Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown";
const REORDER_CLASSES = "cursor-grab active:cursor-grabbing data-[drop-target=true]:border-primary data-[drop-target=true]:bg-primary/15";
const REORDER_HINT = "Drag to reorder or press Shift + an arrow key";

type ViewItemProps = {
  view: WorkItemQueryView;
  query: ViewCountQueryResult | undefined;
  stats: ViewCardStats;
  selected: boolean;
  buttonRef: (element: HTMLButtonElement | null) => void;
  onSelect: () => void;
  onEdit: () => void;
  drag?: ColumnDragProps;
};

export function ViewCard({
  view,
  query,
  stats,
  selected,
  buttonRef,
  onSelect,
  onEdit,
  drag,
}: ViewItemProps) {
  return (
    <button
      {...drag?.handle}
      {...drag?.cell}
      ref={buttonRef}
      type="button"
      role="option"
      aria-selected={selected}
      aria-keyshortcuts={OPTION_KEY_SHORTCUTS}
      onClick={onSelect}
      onDoubleClick={onEdit}
      className={`group rounded-md border px-2.5 py-1.5 text-left outline-none transition-colors focus:ring-2 focus:ring-inset focus:ring-ring ${drag ? REORDER_CLASSES : ""} ${selectionClasses(
        selected,
        stats.alerting,
      )}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold" title={view.name}>
          {view.name}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {drag ? <span title={REORDER_HINT} className="flex items-center gap-1 text-muted-foreground" aria-hidden="true">
            <GripVertical className="h-3.5 w-3.5" />
            <span className="hidden text-2xs group-focus:inline">Shift+←/→/↑/↓</span>
          </span> : null}
          {view.pinned ? <Pin className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> : null}
          {query?.isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : null}
        </span>
      </div>
      <div className="mt-1 flex items-end gap-1.5">
        <span
          className={`text-2xl font-semibold leading-none tabular-nums ${stats.alerting ? "text-destructive" : ""}`}
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
        {query?.isError ? null : (
          <span className="min-w-0 flex-1">
            <ViewCountSparkline points={stats.history} viewName={view.name} />
          </span>
        )}
      </div>
      {/* One meta line: limit, sort and the per-view options. */}
      <p className="mt-1 truncate text-2xs text-muted-foreground">
        {query?.isError
          ? commandErrorMessage(query.error)
          : view.limit !== undefined
            ? `${view.limit} max`
            : "no limit"}
        {" · "}
        {(view.sortKey ?? "changedDate")} {(view.sortDirection ?? "desc").toUpperCase()}
        {view.previewVisible === false ? " · preview off" : ""}
        {view.refreshIntervalSec ? ` · auto ${view.refreshIntervalSec}s` : ""}
        {view.alertThreshold !== undefined ? ` · alert ≥${view.alertThreshold}` : ""}
      </p>
    </button>
  );
}

/**
 * The compact row doubles as the chip in the one-row display (`chip`): same
 * content, but a fixed toolbar height and no grid placement.
 */
export function ViewCompactRow({
  view,
  query,
  stats,
  selected,
  buttonRef,
  onSelect,
  onEdit,
  drag,
  chip = false,
}: ViewItemProps & { chip?: boolean }) {
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
      {...drag?.handle}
      {...drag?.cell}
      ref={buttonRef}
      type="button"
      role="option"
      aria-selected={selected}
      aria-keyshortcuts={OPTION_KEY_SHORTCUTS}
      onClick={onSelect}
      onDoubleClick={onEdit}
      title={metaTitle}
      className={`group inline-flex items-center text-left outline-none transition-colors focus:ring-2 focus:ring-inset focus:ring-ring ${
        chip
          ? "h-8 shrink-0 gap-1.5 rounded-md border px-2.5"
          : "w-fit max-w-full gap-2 justify-self-start rounded border px-2 py-1"
      } ${drag ? REORDER_CLASSES : ""} ${selectionClasses(
        selected,
        stats.alerting,
      )}`}
    >
      {drag ? <span title={REORDER_HINT}><GripVertical className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /></span> : null}
      <span
        className={`flex shrink-0 items-center justify-center ${
          chip && !query?.isFetching && !stats.alerting && !view.pinned ? "hidden" : "h-3.5 w-3.5"
        }`}
      >
        {query?.isFetching ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : stats.alerting ? (
          <TriangleAlert className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
        ) : view.pinned ? (
          <Pin className="h-3 w-3 text-primary" aria-hidden="true" />
        ) : null}
      </span>
      <span className="min-w-0 max-w-[140px] truncate text-xs font-medium" title={view.name}>
        {view.name}
      </span>
      {drag || chip ? <span aria-hidden="true" className="hidden shrink-0 text-2xs text-muted-foreground group-focus:inline">
        Shift+←/→/↑/↓
      </span> : null}
      <span
        className={`shrink-0 text-xs font-semibold tabular-nums ${stats.alerting ? "text-destructive" : ""}`}
      >
        {query?.isError ? "!" : stats.displayCount}
      </span>
      {stats.delta !== null && stats.delta !== 0 && !query?.isError ? (
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
          {stats.delta > 0 ? `+${stats.delta}` : stats.delta}
        </span>
      ) : null}
    </button>
  );
}
