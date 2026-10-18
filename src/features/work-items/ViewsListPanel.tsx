import { type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Columns3,
  Eye,
  EyeOff,
  LayoutGrid,
  List,
  Pin,
  PinOff,
  Play,
  Plus,
  Rows3,
} from 'lucide-react';
import { type WorkItemQueryView, type WorkItemViewLayout } from './workItemViewsStorage';
import type { WorkItemViewsCardMode } from './workItemViewsDisplayStorage';
import {
  ViewCard,
  ViewCompactRow,
  viewCardStats,
  type ViewCountQueryResult,
} from './ViewsListItems';
import { HeaderToolbarPortal } from '@/components/HeaderToolbarSlot';
import { WorkItemViewsOverflowMenu } from './WorkItemViewsOverflowMenu';

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

  // "Collapsed" is the default one-row chip display (a borderless toolbar row,
  // same height as the search rows); expanded is the card/compact-row grid.
  const chips = collapsed;
  const iconBtn = "h-7 w-7";
  const textBtn = "h-7";

  const toggle = (
    <button
      ref={collapseToggleRef}
      type="button"
      onClick={onCollapsedToggle}
      aria-expanded={!collapsed}
      aria-keyshortcuts="Control+B"
      title={collapsed ? "Show view cards (Ctrl+B)" : "Collapse to one row of chips (Ctrl+B)"}
      className={`inline-flex shrink-0 items-center justify-center rounded-md border border-border hover:bg-secondary ${iconBtn}`}
    >
      {collapsed ? (
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </button>
  );

  const headerRow = (
    <div
      className={
        chips
          ? "flex min-w-0 flex-1 items-center gap-2"
          : "flex items-center justify-between border-b border-border px-2 py-1"
      }
    >
      {chips ? (
        <>
          {toggle}
          {/* The header breadcrumb already says "Views"; keep the heading for screen readers only. */}
          <h2 className="sr-only">Views</h2>
          {views.length === 0 ? (
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              No saved WIQL views (N to add one)
            </p>
          ) : (
            <div
              role="listbox"
              aria-label="Saved work item views"
              aria-orientation="horizontal"
              data-views-panel="true"
              className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto"
              style={{ scrollbarWidth: "thin" }}
              onKeyDown={onKeyDown}
            >
              {views.map((view, index) => (
                <ViewCompactRow
                  key={view.id}
                  chip
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
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="flex min-w-0 items-center gap-2">
          {toggle}
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="text-sm font-semibold">Views</h2>
            <p className="text-xs text-muted-foreground">
              {views.length === 0
                ? "No saved WIQL views"
                : `${views.length} saved view${views.length === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1.5">
        {chips ? null : (
        <>
        <div
          role="group"
          aria-label="View list density"
          className="inline-flex items-center rounded-md border border-border p-0.5"
        >
          <button
            type="button"
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
        </>
        )}
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
        {chips ? null : (
        <>
        <button
          type="button"
          disabled={!selectedView}
          onClick={onPinToggle}
          title={selectedView?.pinned ? "Unpin selected view" : "Pin selected view"}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {selectedView?.pinned ? (
            <PinOff className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Pin className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span className="sr-only">{selectedView?.pinned ? "Unpin" : "Pin"}</span>
        </button>
        <button
          type="button"
          disabled={!selectedView || selectedViewIndex <= 0}
          onClick={onMoveLeft}
          title="Move selected view left"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={!selectedView || selectedViewIndex >= views.length - 1}
          onClick={onMoveRight}
          title="Move selected view right"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
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
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {selectedView?.previewVisible === false ? (
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span className="sr-only">Preview</span>
        </button>
        </>
        )}
        <WorkItemViewsOverflowMenu
          viewActions={
            chips
              ? {
                  pinned: !!selectedView?.pinned,
                  previewVisible: selectedView?.previewVisible !== false,
                  canMoveLeft: !!selectedView && selectedViewIndex > 0,
                  canMoveRight: !!selectedView && selectedViewIndex < views.length - 1,
                  onPinToggle,
                  onPreviewToggle,
                  onMoveLeft,
                  onMoveRight,
                }
              : undefined
          }
          hasSelectedView={!!selectedView}
          hasViews={views.length > 0}
          importInputRef={importInputRef}
          onShare={onShare}
          onExport={onExport}
          onImport={onImport}
          onDelete={onDelete}
        />
        <button
          type="button"
          disabled={!selectedView}
          onClick={onEditOpen}
          aria-keyshortcuts="E"
          title="Edit selected view (E)"
          className={`inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50 ${textBtn}`}
        >
          Edit
        </button>
        <button
          type="button"
          disabled={views.length === 0}
          onClick={onRun}
          title="Run all views (R)"
          className={`inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50 ${textBtn}`}
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-keyshortcuts="N"
          onClick={onAddOpen}
          title="Add new view (N)"
          className={`inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 ${textBtn}`}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add
        </button>
      </div>
    </div>
  );

  return (
    <div
      className={
        // In chip mode the row lives in the app header, so this wrapper takes no space of its own.
        chips ? "contents" : "shrink-0 overflow-hidden rounded-md border border-border bg-card"
      }
    >
      {chips ? <HeaderToolbarPortal>{headerRow}</HeaderToolbarPortal> : headerRow}

      {viewMessage ? (
        <div
          role="status"
          className={`text-xs text-muted-foreground ${
            chips ? "pt-1" : "border-b border-border px-3 py-1"
          }`}
        >
          {viewMessage}
        </div>
      ) : null}

      {chips ? null : views.length === 0 ? (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
          Save a WIQL view to start tracking result counts.
        </div>
      ) : (
        <div
          role="listbox"
          aria-label="Saved work item views"
          data-views-panel="true"
          className={cardMode === "compact" ? "flex flex-wrap items-start gap-1 overflow-auto p-1.5" : "grid gap-2 overflow-auto p-2"}
          style={
            cardMode === "compact"
              ? {
                  maxHeight: "min(24vh, 200px)",
                }
              : {
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 240px))",
                  maxHeight: "min(30vh, 200px)",
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
