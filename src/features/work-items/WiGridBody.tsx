import { LoadingState } from '@/components/StateDisplay';
import type { WorkItemSummary } from '@/lib/azdoCommands';
import { matchRowColorClass, type RowColorRule } from '@/lib/rowColorRules';
import { workItemUnreadKey } from './workItemUnreadTracking';
import { WorkItemGridRow } from './WorkItemGridRow';
import { workItemSummaryKey, type WiSortKey } from './workItemsGridHelpers';

export function WiGridBody({
  showBlockingLoading,
  searched,
  sorted,
  displayed,
  emptyMessage,
  clearAllFilters,
  firstVirtualRow,
  virtualRows,
  selectedIndex,
  checkedIds,
  unreadKeys,
  wiColTemplate,
  visibleColumns,
  extraColumns,
  staleThresholdDays,
  rowColorRules,
  rowRefs,
  virtualTopPadding,
  virtualBottomPadding,
  setSelectedIndex,
  handleCheckboxChange,
  onShiftRangeSelect,
  onCtrlToggleSelect,
  onClearSelection,
}: {
  showBlockingLoading: boolean;
  searched: boolean;
  sorted: WorkItemSummary[];
  displayed: WorkItemSummary[];
  emptyMessage: string | undefined;
  clearAllFilters: () => void;
  firstVirtualRow: number;
  virtualRows: WorkItemSummary[];
  selectedIndex: number;
  checkedIds: Set<string>;
  unreadKeys: Set<string>;
  wiColTemplate: string;
  visibleColumns: WiSortKey[];
  extraColumns: string[];
  staleThresholdDays: number;
  rowColorRules: RowColorRule[];
  rowRefs: React.RefObject<(HTMLDivElement | null)[]>;
  virtualTopPadding: number;
  virtualBottomPadding: number;
  setSelectedIndex: (i: number) => void;
  handleCheckboxChange: (index: number, checked: boolean, shiftKey: boolean) => void;
  onShiftRangeSelect: (index: number, anchorIndex?: number) => void;
  onCtrlToggleSelect: (index: number, focusedIndex: number) => void;
  onClearSelection: () => void;
}) {
  if (showBlockingLoading) {
    return <LoadingState />;
  }
  if (!searched) {
    return (
      <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
        {emptyMessage ?? "Run a search to load work items."}
      </div>
    );
  }
  if (sorted.length === 0) {
    return (
      <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
        No work items matched.
      </div>
    );
  }
  if (displayed.length === 0) {
    return (
      <div className="flex min-h-24 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <span>No items match the active filters.</span>
        <button
          type="button"
          onClick={clearAllFilters}
          className="rounded border border-border px-2 py-0.5 text-xs hover:bg-secondary"
        >
          Clear filters
        </button>
      </div>
    );
  }
  return (
    <div
      role="grid"
      aria-label="Work items"
      data-primary-grid="true"
      tabIndex={-1}
    >
      {virtualTopPadding > 0 ? (
        <div style={{ height: virtualTopPadding }} />
      ) : null}
      {virtualRows.map((item, offset) => {
        const i = firstVirtualRow + offset;
        return (
          <WorkItemGridRow
            key={`${item.organizationId}:${item.projectId}:${item.id}`}
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
            item={item}
            selected={i === selectedIndex}
            checked={checkedIds.has(`${item.organizationId}:${item.projectId}:${item.id}`)}
            unread={unreadKeys.has(workItemUnreadKey(item.organizationId, item.id))}
            columnTemplate={wiColTemplate}
            visibleColumns={visibleColumns}
            extraColumns={extraColumns}
            staleThresholdDays={staleThresholdDays}
            rowColorClass={matchRowColorClass(
              {
                state: item.state,
                type: item.workItemType,
                assignedTo: item.assignedTo,
                title: item.title,
              },
              rowColorRules,
            )}
            onSelect={({ shiftKey, ctrlKey }) => {
              // Shift/Ctrl+click drives the same checkbox selection the bulk
              // actions and Ctrl+C already read from, so the row body and the
              // checkbox never disagree about what is selected.
              if (shiftKey) {
                // Anchor the range on the row that was focused *before* this
                // click, so the first Shift+click still selects a range. The
                // anchor is passed explicitly because `selectedIndex` has
                // already moved to the clicked row by the time this runs.
                onShiftRangeSelect(i, selectedIndex);
              } else if (ctrlKey) {
                // Seed from the focused row so the first Ctrl+click grows the
                // selection to two rows rather than leaving just the clicked one.
                onCtrlToggleSelect(i, selectedIndex);
              } else if (checkedIds.size > 0) {
                // A plain click on the row body starts a fresh selection, the
                // same as the other grids. The checkbox column is untouched, so
                // deliberate checkbox picking still survives a click elsewhere.
                onClearSelection();
              }
              setSelectedIndex(i);
            }}
            onCheckedChange={(checked, shiftKey) => handleCheckboxChange(i, checked, shiftKey)}
          />
        );
      })}
      {virtualBottomPadding > 0 ? (
        <div style={{ height: virtualBottomPadding }} />
      ) : null}
    </div>
  );
}

// Re-export the key helper so WiGridBody callers can use it without a separate import.
export { workItemSummaryKey };
