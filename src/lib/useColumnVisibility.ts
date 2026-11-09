import { useCallback, useEffect, useState } from "react";
import { moveColumnTo } from "./columnDrag";

// Normalizes a stored/raw column list, keeping the stored (user-chosen) order,
// dropping unknown keys and forcing the required (never-hidden) columns to stay
// present. Falls back to all keys when nothing valid remains.
export function normalizeVisibleColumns<Key extends string>(
  keys: readonly Key[],
  requiredColumns: readonly Key[],
  raw: unknown,
): Key[] {
  if (!Array.isArray(raw)) return [...keys];
  const set = new Set(raw.filter((value): value is Key => keys.includes(value as Key)));
  for (const required of requiredColumns) set.add(required);
  return set.size > 0 ? [...set] : [...keys];
}

// Shows a hidden column: placed just before the next column (in canonical
// order) that is already visible, or last when none follows.
export function showColumn<Key extends string>(
  keys: readonly Key[],
  current: readonly Key[],
  column: Key,
): Key[] {
  const next = keys.slice(keys.indexOf(column) + 1).find((key) => current.includes(key));
  const at = next === undefined ? current.length : current.indexOf(next);
  return [...current.slice(0, at), column, ...current.slice(at)];
}

// Moves `column` by `delta` positions within the visible list (clamped).
export function moveColumnBy<Key extends string>(
  current: readonly Key[],
  column: Key,
  delta: number,
): Key[] {
  const from = current.indexOf(column);
  if (from < 0) return [...current];
  const to = Math.max(0, Math.min(current.length - 1, from + delta));
  const next = [...current];
  next.splice(from, 1);
  next.splice(to, 0, column);
  return next;
}

// Manages which columns a grid shows: the visible list, a toggle that respects
// required columns and preserves the canonical order, and a reset to all
// columns. When `storageKey` is given the list is loaded from and persisted to
// localStorage; otherwise the caller supplies `initialColumns` and owns
// persistence (e.g. grids that fold column visibility into a larger view-state
// blob, like My Reviews).
export function useColumnVisibility<Key extends string>({
  keys,
  requiredColumns,
  storageKey,
  initialColumns,
}: {
  keys: readonly Key[];
  requiredColumns: readonly Key[];
  storageKey?: string;
  initialColumns?: readonly Key[];
}): {
  visibleColumns: Key[];
  setVisibleColumns: React.Dispatch<React.SetStateAction<Key[]>>;
  toggleColumn: (column: Key) => void;
  moveColumn: (column: Key, delta: number) => void;
  reorderColumn: (from: Key, to: Key) => void;
  resetColumns: () => void;
} {
  const [visibleColumns, setVisibleColumns] = useState<Key[]>(() => {
    if (storageKey) {
      try {
        return normalizeVisibleColumns(
          keys,
          requiredColumns,
          JSON.parse(window.localStorage.getItem(storageKey) ?? "null"),
        );
      } catch {
        return [...keys];
      }
    }
    return normalizeVisibleColumns(keys, requiredColumns, initialColumns ?? null);
  });

  useEffect(() => {
    if (!storageKey) return;
    window.localStorage.setItem(storageKey, JSON.stringify(visibleColumns));
  }, [storageKey, visibleColumns]);

  const toggleColumn = useCallback(
    (column: Key) => {
      if (requiredColumns.includes(column)) return;
      setVisibleColumns((current) =>
        current.includes(column)
          ? current.filter((key) => key !== column)
          : showColumn(keys, current, column),
      );
    },
    [keys, requiredColumns],
  );

  const moveColumn = useCallback(
    (column: Key, delta: number) => setVisibleColumns((current) => moveColumnBy(current, column, delta)),
    [],
  );

  const reorderColumn = useCallback(
    (from: Key, to: Key) => setVisibleColumns((current) => moveColumnTo(current, from, to)),
    [],
  );

  const resetColumns = useCallback(() => {
    setVisibleColumns([...keys]);
  }, [keys]);

  return { visibleColumns, setVisibleColumns, toggleColumn, moveColumn, reorderColumn, resetColumns };
}
