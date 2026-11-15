import { memo, useCallback } from "react";
import type { MyCreatedPullRequestSummary } from "@/lib/azdoCommands";
import { CreatedPrRow } from "./MyPullRequestsRow";
import type { SortKey } from "./myPullRequestsTypes";

// One grid row. Memoized so that moving the selection or filtering the list
// only re-renders the rows whose own props actually changed. `onSelect` and
// the row `ref` callback are built here (not in the parent's map) so they stay
// stable per row instead of being recreated — and thus invalidating the memo —
// on every render.
export const MemoCreatedPrRow = memo(function MemoCreatedPrRow({
  index,
  pr,
  columnTemplate,
  visibleColumns,
  selected,
  inMultiSelection,
  rowRefs,
  handleRowClick,
  setSelectedIndex,
}: {
  index: number;
  pr: MyCreatedPullRequestSummary;
  columnTemplate: string;
  visibleColumns: SortKey[];
  selected: boolean;
  inMultiSelection: boolean;
  rowRefs: React.RefObject<Array<HTMLDivElement | null>>;
  handleRowClick: (
    index: number,
    modifiers: { shiftKey: boolean; ctrlKey: boolean },
    setSelectedIndex: (index: number) => void,
  ) => void;
  setSelectedIndex: (index: number) => void;
}) {
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      rowRefs.current[index] = el;
    },
    [rowRefs, index],
  );

  const onSelect = useCallback(
    (modifiers: { shiftKey: boolean; ctrlKey: boolean }) =>
      handleRowClick(index, modifiers, setSelectedIndex),
    [handleRowClick, index, setSelectedIndex],
  );

  return (
    <CreatedPrRow
      ref={setRef}
      pr={pr}
      columnTemplate={columnTemplate}
      visibleColumns={visibleColumns}
      selected={selected}
      inMultiSelection={inMultiSelection}
      onSelect={onSelect}
    />
  );
});
