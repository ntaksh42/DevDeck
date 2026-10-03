import { useCallback, useState } from "react";
import { useLatestRef } from "./useLatestRef";

// Keep the focused item across refreshes; only fall back to its previous
// position when its key is no longer visible (including collapsed sections).
export function useKeyedGridSelection<T>(
  rows: T[],
  keyOf: (row: T) => string,
  visibleIndexes?: number[],
) {
  const [selection, setSelection] = useState<{ key: string | null; index: number }>({
    key: null,
    index: 0,
  });
  const keyedIndex = selection.key === null
    ? -1
    : rows.findIndex((row) => keyOf(row) === selection.key);
  const selectedIndex = keyedIndex >= 0 && (!visibleIndexes || visibleIndexes.includes(keyedIndex))
    ? keyedIndex
    : visibleIndexes
      ? visibleIndexes.find((index) => index >= selection.index) ?? visibleIndexes[visibleIndexes.length - 1] ?? 0
      : Math.min(selection.index, Math.max(0, rows.length - 1));
  const selectedRow = visibleIndexes?.length === 0 ? null : rows[selectedIndex] ?? null;
  const key = selectedRow === null ? null : keyOf(selectedRow);

  // Reconcile before children render, so previews and action handlers never
  // receive an intermediate selection based on the old row number.
  if (key !== selection.key || selectedIndex !== selection.index) {
    setSelection({ key, index: selectedIndex });
  }

  const depsRef = useLatestRef({ rows, keyOf });
  const setSelectedIndex = useCallback((index: number) => {
    const { rows, keyOf } = depsRef.current;
    const row = rows[index];
    if (row) setSelection({ key: keyOf(row), index });
  }, []);

  return { selectedIndex: selectedRow === null ? -1 : selectedIndex, setSelectedIndex, selectedRow };
}
