import { useCallback, useEffect, useState } from "react";

// Shift/Ctrl row multi-selection shared by the grids that only track a single
// roving `selectedIndex` (My Pull Requests, PR search, Commits). Rows are
// identified by a caller-supplied stable key so the selection survives sorting,
// filtering, and background sync replacing the row objects.
//
// My Reviews and Work Items already own richer selection state (section-aware
// ranges, checkboxes) and keep using theirs.
export function useRangeSelection<T>({
  rows,
  keyOf,
  selectedIndex,
}: {
  rows: T[];
  keyOf: (row: T) => string;
  selectedIndex: number;
}): {
  selectedKeys: Set<string>;
  selectedRows: T[];
  isMultiSelect: boolean;
  extendTo: (index: number) => void;
  toggleAt: (index: number) => void;
  clear: () => void;
  handleRowClick: (
    index: number,
    modifiers: { shiftKey: boolean; ctrlKey: boolean },
    setSelectedIndex: (index: number) => void,
  ) => void;
} {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [anchorKey, setAnchorKey] = useState<string | null>(null);

  // Drop keys whose rows disappeared (filter change, sync) so the status bar
  // and copy action never report rows the user cannot see.
  useEffect(() => {
    setSelectedKeys((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(rows.map(keyOf));
      const next = new Set([...prev].filter((key) => present.has(key)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const extendTo = useCallback(
    (index: number) => {
      const target = rows[index];
      if (!target) return;
      const anchor = anchorKey ?? keyOf(rows[selectedIndex] ?? target);
      const anchorIndex = rows.findIndex((row) => keyOf(row) === anchor);
      if (anchorIndex < 0) return;
      const [from, to] =
        anchorIndex <= index ? [anchorIndex, index] : [index, anchorIndex];
      const next = new Set<string>();
      for (let i = from; i <= to; i += 1) {
        const row = rows[i];
        if (row) next.add(keyOf(row));
      }
      setAnchorKey(anchor);
      setSelectedKeys(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, anchorKey, selectedIndex],
  );

  const toggleAt = useCallback(
    (index: number) => {
      const target = rows[index];
      if (!target) return;
      const key = keyOf(target);
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        // A Ctrl+click on a grid with no explicit multi-selection yet should
        // build on the row the user already has selected, not start from empty.
        if (next.size === 0) {
          const current = rows[selectedIndex];
          if (current) next.add(keyOf(current));
        }
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      setAnchorKey(key);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, selectedIndex],
  );

  const clear = useCallback(() => {
    setSelectedKeys((prev) => (prev.size === 0 ? prev : new Set()));
    setAnchorKey(null);
  }, []);

  // Row click with modifiers, shared by every grid that uses this hook: Shift
  // extends the range, Ctrl toggles one row, a plain click starts over.
  const handleRowClick = useCallback(
    (
      index: number,
      modifiers: { shiftKey: boolean; ctrlKey: boolean },
      setSelectedIndex: (index: number) => void,
    ) => {
      if (modifiers.shiftKey) {
        setSelectedIndex(index);
        extendTo(index);
      } else if (modifiers.ctrlKey) {
        toggleAt(index);
        setSelectedIndex(index);
      } else {
        clear();
        setSelectedIndex(index);
      }
    },
    [extendTo, toggleAt, clear],
  );

  // With no explicit multi-selection the "selection" is just the focused row,
  // so copy actions work the same whether or not the user selected a range.
  const selectedRows =
    selectedKeys.size === 0
      ? rows[selectedIndex]
        ? [rows[selectedIndex]]
        : []
      : rows.filter((row) => selectedKeys.has(keyOf(row)));

  return {
    selectedKeys,
    selectedRows,
    isMultiSelect: selectedKeys.size >= 2,
    extendTo,
    toggleAt,
    clear,
    handleRowClick,
  };
}
