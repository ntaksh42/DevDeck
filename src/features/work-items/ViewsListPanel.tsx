import { type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Columns3,
  Copy,
  Download,
  Eye,
  EyeOff,
  List,
  Loader2,
  Pin,
  PinOff,
  Play,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { commandErrorMessage } from '@/lib/azdoCommands';
import { viewCountBaseline, type WorkItemQueryView, type WorkItemViewLayout } from './workItemViewsStorage';

type ViewCountQueryResult = {
  data?: number;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
};

export type ViewsListPanelProps = {
  views: WorkItemQueryView[];
  selectedView: WorkItemQueryView | null;
  selectedViewIndex: number;
  viewCountQueries: ViewCountQueryResult[];
  layout: WorkItemViewLayout;
  viewMessage: string | null;
  viewButtonRefs: React.MutableRefObject<(HTMLButtonElement | null)[]>;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  onLayoutChange: (layout: WorkItemViewLayout) => void;
  onPinToggle: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onPreviewToggle: () => void;
  onShare: () => void;
  onExport: () => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onEditOpen: () => void;
  onDelete: () => void;
  onRun: () => void;
  onAddOpen: () => void;
  onSelectView: (view: WorkItemQueryView) => void;
  onEditView: (view: WorkItemQueryView) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
};

export function ViewsListPanel({
  views,
  selectedView,
  selectedViewIndex,
  viewCountQueries,
  layout,
  viewMessage,
  viewButtonRefs,
  importInputRef,
  onLayoutChange,
  onPinToggle,
  onMoveLeft,
  onMoveRight,
  onPreviewToggle,
  onShare,
  onExport,
  onImport,
  onEditOpen,
  onDelete,
  onRun,
  onAddOpen,
  onSelectView,
  onEditView,
  onKeyDown,
}: ViewsListPanelProps) {
  return (
    <div className="shrink-0 overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold">Views</h2>
          <p className="text-xs text-muted-foreground">
            {views.length === 0
              ? "No saved WIQL views"
              : `${views.length} saved view${views.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            role="group"
            aria-label="Result layout"
            className="inline-flex items-center rounded-md border border-border p-0.5"
          >
            <button
              type="button"
              disabled={!selectedView}
              aria-pressed={layout === "list"}
              onClick={() => onLayoutChange("list")}
              title="List layout"
              className={`inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                layout === "list" ? "bg-secondary text-foreground" : "hover:bg-secondary/60"
              }`}
            >
              <List className="h-3.5 w-3.5" aria-hidden="true" />
              List
            </button>
            <button
              type="button"
              disabled={!selectedView}
              aria-pressed={layout === "board"}
              onClick={() => onLayoutChange("board")}
              title="Board layout"
              className={`inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                layout === "board" ? "bg-secondary text-foreground" : "hover:bg-secondary/60"
              }`}
            >
              <Columns3 className="h-3.5 w-3.5" aria-hidden="true" />
              Board
            </button>
          </div>
          <button
            type="button"
            disabled={!selectedView}
            onClick={onPinToggle}
            title={selectedView?.pinned ? "Unpin selected view" : "Pin selected view"}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {selectedView?.pinned ? (
              <PinOff className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Pin className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {selectedView?.pinned ? "Unpin" : "Pin"}
          </button>
          <button
            type="button"
            disabled={!selectedView || selectedViewIndex <= 0}
            onClick={onMoveLeft}
            title="Move selected view left"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={!selectedView || selectedViewIndex >= views.length - 1}
            onClick={onMoveRight}
            title="Move selected view right"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={!selectedView}
            onClick={onPreviewToggle}
            title={
              selectedView?.previewVisible === false
                ? "Show preview for this view"
                : "Hide preview for this view"
            }
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {selectedView?.previewVisible === false ? (
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Preview
          </button>
          <button
            type="button"
            disabled={!selectedView}
            onClick={onShare}
            aria-label="Copy selected view share JSON"
            title="Copy selected view share JSON"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            Share
          </button>
          <button
            type="button"
            disabled={views.length === 0}
            onClick={onExport}
            title="Export all views as JSON"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            title="Import views from JSON"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            Import
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => void onImport(event)}
          />
          <button
            type="button"
            disabled={!selectedView}
            onClick={onEditOpen}
            aria-keyshortcuts="E"
            title="Edit selected view (E)"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Edit
          </button>
          <button
            type="button"
            disabled={!selectedView}
            onClick={onDelete}
            aria-keyshortcuts="Delete"
            title="Delete selected view (Del)"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={views.length === 0}
            onClick={onRun}
            title="Run all views (R)"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-keyshortcuts="N"
            onClick={onAddOpen}
            title="Add new view (N)"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add
          </button>
        </div>
      </div>

      {viewMessage ? (
        <div
          role="status"
          className="border-b border-border px-3 py-1 text-xs text-muted-foreground"
        >
          {viewMessage}
        </div>
      ) : null}

      {views.length === 0 ? (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
          Save a WIQL view to start tracking result counts.
        </div>
      ) : (
        <div
          role="listbox"
          aria-label="Saved work item views"
          data-views-panel="true"
          className="grid gap-3 overflow-auto p-3"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            maxHeight: "min(40vh, 320px)",
          }}
          onKeyDown={onKeyDown}
        >
          {views.map((view, index) => {
            const query = viewCountQueries[index];
            const count = query?.data ?? 0;
            const overflow = typeof query?.data === "number" && query.data > view.limit;
            const displayCount = overflow ? `${view.limit}+` : count;
            const baseline = viewCountBaseline(view.id);
            const delta =
              typeof query?.data === "number" && baseline !== null
                ? query.data - baseline
                : null;
            const alerting =
              typeof view.alertThreshold === "number" &&
              typeof query?.data === "number" &&
              query.data >= view.alertThreshold;
            const selected = selectedView?.id === view.id;
            return (
              <button
                key={view.id}
                ref={(element) => {
                  viewButtonRefs.current[index] = element;
                }}
                type="button"
                role="option"
                aria-selected={selected}
                aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End Delete N E R"
                onClick={() => onSelectView(view)}
                onDoubleClick={() => onEditView(view)}
                className={`min-h-[88px] rounded-md border p-3 text-left outline-none transition-colors focus:ring-2 focus:ring-inset focus:ring-ring ${
                  alerting
                    ? selected
                      ? "border-destructive bg-secondary"
                      : "border-destructive bg-destructive/5 hover:bg-destructive/10"
                    : selected
                      ? "border-primary bg-secondary"
                      : "border-border bg-card hover:bg-muted/60"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold" title={view.name}>
                    {view.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {view.pinned ? (
                      <Pin className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                    ) : null}
                    {query?.isFetching ? (
                      <Loader2
                        className="h-4 w-4 animate-spin text-muted-foreground"
                        aria-hidden="true"
                      />
                    ) : null}
                  </span>
                </div>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span
                    className={`text-3xl font-semibold leading-none ${
                      alerting ? "text-destructive" : ""
                    }`}
                  >
                    {query?.isError ? "!" : displayCount}
                  </span>
                  {delta !== null && delta !== 0 && !query?.isError ? (
                    <span
                      className="text-xs font-medium text-muted-foreground"
                      title="Change since the previous session"
                    >
                      {delta > 0 ? `+${delta}` : delta}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {query?.isError
                    ? commandErrorMessage(query.error)
                    : `${view.limit} max results`}
                </p>
                <p className="mt-1 truncate text-[11px] text-muted-foreground/80">
                  {(view.sortKey ?? "changedDate")} {(view.sortDirection ?? "desc").toUpperCase()}
                  {view.previewVisible === false ? " · preview off" : ""}
                  {view.refreshIntervalSec ? ` · auto ${view.refreshIntervalSec}s` : ""}
                  {view.alertThreshold !== undefined ? ` · alert ≥${view.alertThreshold}` : ""}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
