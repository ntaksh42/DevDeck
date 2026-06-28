import { useCallback, useEffect, useState } from "react";

// Normalizes a stored/raw column list to the canonical key order, dropping
// unknown keys and forcing the required (never-hidden) columns to stay present.
// Falls back to all keys when nothing valid remains.
export function normalizeVisibleColumns<Key extends string>(
  keys: readonly Key[],
  requiredColumns: readonly Key[],
  raw: unknown,
): Key[] {
  if (!Array.isArray(raw)) return [...keys];
  const set = new Set(raw.filter((value): value is Key => keys.includes(value as Key)));
  for (const required of requiredColumns) set.add(required);
  const ordered = keys.filter((key) => set.has(key));
  return ordered.length > 0 ? ordered : [...keys];
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
          : keys.filter((key) => key === column || current.includes(key)),
      );
    },
    [keys, requiredColumns],
  );

  const resetColumns = useCallback(() => {
    setVisibleColumns([...keys]);
  }, [keys]);

  return { visibleColumns, setVisibleColumns, toggleColumn, resetColumns };
}
