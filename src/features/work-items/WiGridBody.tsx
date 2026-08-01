import { memo, useCallback, useMemo, useRef } from 'react';
import { LoadingState, PreviewEmptyState, SEARCH_EMPTY_HINT } from '@/components/StateDisplay';
import type { WorkItemSummary } from '@/lib/azdoCommands';
import { matchRowColorClass, type RowColorRule } from '@/lib/rowColorRules';
import { workItemUnreadKey } from './workItemUnreadTracking';
import { WorkItemGridRow } from './WorkItemGridRow';
import { workItemSummaryKey, type WiSortKey } from './workItemsGridHelpers';
import type { ExtraColumn } from './extraColumns';

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
  extraColumns: ExtraColumn[];
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
  // Rows read the focused index from this ref rather than as a prop: passing
  // `selectedIndex` to every row would invalidate the whole memoized window on
  // each arrow-key press, which is exactly what the memo is there to avoid.
  const focusedIndexRef = useRef(selectedIndex);
  focusedIndexRef.current = selectedIndex;

  if (showBlockingLoading) {
    return <LoadingState />;
  }
  if (!searched) {
    return (
      <PreviewEmptyState
        message={emptyMessage ?? "Run a search to load work items."}
        hint={emptyMessage ? undefined : SEARCH_EMPTY_HINT}
      />
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
      {virtualRows.map((item, offset) => (
        <MemoWiRow
          key={`${item.organizationId}:${item.projectId}:${item.id}`}
          index={firstVirtualRow + offset}
          item={item}
          selected={firstVirtualRow + offset === selectedIndex}
          checked={checkedIds.has(workItemSummaryKey(item))}
          unread={unreadKeys.has(workItemUnreadKey(item.organizationId, item.id))}
          columnTemplate={wiColTemplate}
          visibleColumns={visibleColumns}
          extraColumns={extraColumns}
          staleThresholdDays={staleThresholdDays}
          rowColorRules={rowColorRules}
          rowRefs={rowRefs}
          hasCheckedRows={checkedIds.size > 0}
          focusedIndexRef={focusedIndexRef}
          setSelectedIndex={setSelectedIndex}
          handleCheckboxChange={handleCheckboxChange}
          onShiftRangeSelect={onShiftRangeSelect}
          onCtrlToggleSelect={onCtrlToggleSelect}
          onClearSelection={onClearSelection}
        />
      ))}
      {virtualBottomPadding > 0 ? (
        <div style={{ height: virtualBottomPadding }} />
      ) : null}
    </div>
  );
}

// One virtualized row. Memoized so that moving the selection, typing in the
// filter box, or a background sync only re-renders the rows whose own props
// changed instead of every visible row. The click handlers are built here (not
// in the parent's map) so they stay stable per row, and the pre-click focused
// index is read from a ref for the same reason.
const MemoWiRow = memo(function MemoWiRow({
  index,
  item,
  selected,
  checked,
  unread,
  columnTemplate,
  visibleColumns,
  extraColumns,
  staleThresholdDays,
  rowColorRules,
  rowRefs,
  hasCheckedRows,
  focusedIndexRef,
  setSelectedIndex,
  handleCheckboxChange,
  onShiftRangeSelect,
  onCtrlToggleSelect,
  onClearSelection,
}: {
  index: number;
  item: WorkItemSummary;
  selected: boolean;
  checked: boolean;
  unread: boolean;
  columnTemplate: string;
  visibleColumns: WiSortKey[];
  extraColumns: ExtraColumn[];
  staleThresholdDays: number;
  rowColorRules: RowColorRule[];
  rowRefs: React.RefObject<(HTMLDivElement | null)[]>;
  hasCheckedRows: boolean;
  focusedIndexRef: React.RefObject<number>;
  setSelectedIndex: (i: number) => void;
  handleCheckboxChange: (index: number, checked: boolean, shiftKey: boolean) => void;
  onShiftRangeSelect: (index: number, anchorIndex?: number) => void;
  onCtrlToggleSelect: (index: number, focusedIndex: number) => void;
  onClearSelection: () => void;
}) {
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      rowRefs.current[index] = el;
    },
    [rowRefs, index],
  );

  const onSelect = useCallback(
    ({ shiftKey, ctrlKey }: { shiftKey: boolean; ctrlKey: boolean }) => {
      // Shift/Ctrl+click drives the same checkbox selection the bulk actions
      // and Ctrl+C already read from, so the row body and the checkbox never
      // disagree about what is selected.
      const focusedIndex = focusedIndexRef.current;
      if (shiftKey) {
        // Anchor the range on the row that was focused *before* this click, so
        // the first Shift+click still selects a range.
        onShiftRangeSelect(index, focusedIndex);
      } else if (ctrlKey) {
        // Seed from the focused row so the first Ctrl+click grows the selection
        // to two rows rather than leaving just the clicked one.
        onCtrlToggleSelect(index, focusedIndex);
      } else if (hasCheckedRows) {
        // A plain click on the row body starts a fresh selection, the same as
        // the other grids. The checkbox column is untouched, so deliberate
        // checkbox picking still survives a click elsewhere.
        onClearSelection();
      }
      setSelectedIndex(index);
    },
    [
      index,
      hasCheckedRows,
      focusedIndexRef,
      onShiftRangeSelect,
      onCtrlToggleSelect,
      onClearSelection,
      setSelectedIndex,
    ],
  );

  const onCheckedChange = useCallback(
    (nextChecked: boolean, shiftKey: boolean) => handleCheckboxChange(index, nextChecked, shiftKey),
    [handleCheckboxChange, index],
  );

  const rowColorClass = useMemo(
    () =>
      matchRowColorClass(
        {
          state: item.state,
          type: item.workItemType,
          assignedTo: item.assignedTo,
          title: item.title,
        },
        rowColorRules,
      ),
    [item.state, item.workItemType, item.assignedTo, item.title, rowColorRules],
  );

  return (
    <WorkItemGridRow
      ref={setRef}
      item={item}
      selected={selected}
      checked={checked}
      unread={unread}
      columnTemplate={columnTemplate}
      visibleColumns={visibleColumns}
      extraColumns={extraColumns}
      staleThresholdDays={staleThresholdDays}
      rowColorClass={rowColorClass}
      onSelect={onSelect}
      onCheckedChange={onCheckedChange}
    />
  );
});

// Re-export the key helper so WiGridBody callers can use it without a separate import.
export { workItemSummaryKey };
