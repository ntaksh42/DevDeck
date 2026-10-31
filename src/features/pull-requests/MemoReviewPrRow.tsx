import { memo, useCallback } from 'react';
import type { ReviewPullRequestSummary } from '@/lib/azdoCommands';
import { ReviewPrRow } from './ReviewPrRow';
import type { SortKey } from './myReviewsTypes';

// One virtualized row. Memoized so that moving the selection, typing in a
// filter, or a background sync only re-renders the rows whose own props
// changed instead of every visible row. The click handler and ref callback are
// built here (not in the parent's map) so they stay stable per row.
//
// Shift-click doesn't need the current selection/anchor passed in: it's
// implicit in `extendSelectionToIndex(prIndex)` alone, since that function
// (useMyReviewsSelectionState.ts) already reads the current anchor/selection
// through its own internal ref and falls back to the clicked row when there is
// no anchor yet. Passing `selectedIndex`/`selectionAnchor` as props here would
// invalidate every row's memo on every selection change, which is exactly what
// this memoization is meant to avoid.
export const MemoReviewPrRow = memo(function MemoReviewPrRow({
  prIndex,
  pr,
  selected,
  inMultiSelection,
  returned,
  updated,
  columnTemplate,
  visibleColumns,
  staleThresholdDays,
  rowRefs,
  setSelectedIndex,
  extendSelectionToIndex,
  toggleSelectionAt,
  clearMultiSelection,
}: {
  prIndex: number;
  pr: ReviewPullRequestSummary;
  selected: boolean;
  inMultiSelection: boolean;
  returned: boolean;
  updated: boolean;
  columnTemplate: string;
  visibleColumns: SortKey[];
  staleThresholdDays: number;
  rowRefs: React.RefObject<(HTMLDivElement | null)[]>;
  setSelectedIndex: (index: number) => void;
  extendSelectionToIndex: (targetIndex: number, explicitAnchorKey?: string) => void;
  toggleSelectionAt: (targetIndex: number) => void;
  clearMultiSelection: () => void;
}) {
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      rowRefs.current[prIndex] = el;
    },
    [rowRefs, prIndex],
  );

  const onSelect = useCallback(
    ({ shiftKey, ctrlKey }: { shiftKey: boolean; ctrlKey: boolean }) => {
      if (shiftKey) {
        setSelectedIndex(prIndex);
        extendSelectionToIndex(prIndex);
      } else if (ctrlKey) {
        toggleSelectionAt(prIndex);
        setSelectedIndex(prIndex);
      } else {
        clearMultiSelection();
        setSelectedIndex(prIndex);
      }
    },
    [prIndex, setSelectedIndex, extendSelectionToIndex, toggleSelectionAt, clearMultiSelection],
  );

  return (
    <ReviewPrRow
      ref={setRef}
      columnTemplate={columnTemplate}
      pr={pr}
      selected={selected}
      inMultiSelection={inMultiSelection}
      returned={returned}
      updated={updated}
      visibleColumns={visibleColumns}
      staleThresholdDays={staleThresholdDays}
      onSelect={onSelect}
    />
  );
});
