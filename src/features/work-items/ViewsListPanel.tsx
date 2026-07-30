import { type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Columns3,
  Copy,
  Download,
  Eye,
  EyeOff,
  LayoutGrid,
  List,
  Pin,
  PinOff,
  Play,
  Plus,
  Rows3,
  Trash2,
  Upload,
} from 'lucide-react';
import { type WorkItemQueryView, type WorkItemViewLayout } from './workItemViewsStorage';
import type { WorkItemViewsCardMode } from './workItemViewsDisplayStorage';
import {
  ViewCard,
  ViewCompactRow,
  viewCardStats,
  type ViewCountQueryResult,
} from './ViewsListItems';

export type ViewsListPanelProps = {
  views: WorkItemQueryView[];
  selectedView: WorkItemQueryView | null;
  selectedViewIndex: number;
  viewCountQueries: ViewCountQueryResult[];
  layout: WorkItemViewLayout;
  collapsed: boolean;
  onCollapsedToggle: () => void;
  collapseToggleRef: React.RefObject<HTMLButtonElement | null>;
  cardMode: WorkItemViewsCardMode;
  onCardModeChange: (mode: WorkItemViewsCardMode) => void;
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
  collapsed,
  onCollapsedToggle,
  collapseToggleRef,
  cardMode,
  onCardModeChange,
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
  const stats = views.map((view, index) => viewCardStats(view, viewCountQueries[index]));
  const selectedCount = selectedView
    ? viewCountQueries[views.findIndex((view) => view.id === selectedView.id)]?.data
    : undefined;
  const alertingCount = stats.filter((stat) => stat.alerting).length;

  return (
    <div className="shrink-0 overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            ref={collapseToggleRef}
            type="button"
            onClick={onCollapsedToggle}
            aria-expanded={!collapsed}
            aria-keyshortcuts="Control+B"
            title={collapsed ? "Show the view list (Ctrl+B)" : "Hide the view list (Ctrl+B)"}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border hover:bg-secondary"
          >
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
          {collapsed ? (
            // Collapsed keeps the essentials on one line so hiding the list does
            // not also hide which view is on screen.
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="shrink-0 text-sm font-semibold">Views</h2>
              {selectedView ? (
                <>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="min-w-0 truncate text-sm font-medium" title={selectedView.name}>
                    {selectedView.name}
                  </span>
                  {typeof selectedCount === "number" ? (
                    <span className="shrink-0 rounded border border-border px-1.5 text-xs tabular-nums text-muted-foreground">
                      {selectedCount}
                    </span>
                  ) : null}
                </>
              ) : null}
              {alertingCount > 0 ? (
                <span className="shrink-0 rounded border border-destructive/40 bg-destructive/10 px-1.5 text-xs font-medium text-destructive">
                  {alertingCount} alert{alertingCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Views</h2>
              <p className="text-xs text-muted-foreground">
                {views.length === 0
                  ? "No saved WIQL views"
                  : `${views.length} saved view${views.length === 1 ? "" : "s"}`}
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <div
            role="group"
            aria-label="View list density"
            className="inline-flex items-center rounded-md border border-border p-0.5"
          >
            <button
              type="button"
              disabled={collapsed}
              aria-pressed={cardMode === "card"}
              onClick={() => onCardModeChange("card")}
              title="Card view list"
              className={`inline-flex h-7 w-7 items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-50 ${
                cardMode === "card" ? "bg-secondary text-foreground" : "hover:bg-secondary/60"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={collapsed}
              aria-pressed={cardMode === "compact"}
              onClick={() => onCardModeChange("compact")}
              title="Compact view list"
              className={`inline-flex h-7 w-7 items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-50 ${
                cardMode === "compact" ? "bg-secondary text-foreground" : "hover:bg-secondary/60"
              }`}
            >
              <Rows3 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
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

      {collapsed ? null : views.length === 0 ? (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
          Save a WIQL view to start tracking result counts.
        </div>
      ) : (
        <div
          role="listbox"
          aria-label="Saved work item views"
          data-views-panel="true"
          className={cardMode === "compact" ? "grid gap-1 overflow-auto p-2" : "grid gap-3 overflow-auto p-3"}
          style={
            cardMode === "compact"
              ? {
                  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                  maxHeight: "min(24vh, 200px)",
                }
              : {
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  maxHeight: "min(40vh, 320px)",
                }
          }
          onKeyDown={onKeyDown}
        >
          {views.map((view, index) => {
            const Item = cardMode === "compact" ? ViewCompactRow : ViewCard;
            return (
              <Item
                key={view.id}
                view={view}
                query={viewCountQueries[index]}
                stats={stats[index]}
                selected={selectedView?.id === view.id}
                buttonRef={(element) => {
                  viewButtonRefs.current[index] = element;
                }}
                onSelect={() => onSelectView(view)}
                onEdit={() => onEditView(view)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
