import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { gridColumnTemplate, gridColumnsMinWidth, storedNumbers } from "@/lib/utils";

export type ColumnResizeProps = {
  columnIndex: number;
  widths: number[];
  setWidths: Dispatch<SetStateAction<number[]>>;
  min: number;
  max: number;
  defaultWidth: number;
};

/**
 * Shared column-width plumbing for the resizable, virtualized grids
 * (work items, reviews, commit search, PR search). Owns the width state, its
 * localStorage persistence, the `grid-template-columns` string, the wrapper
 * `minWidth` that lets the table grow past the viewport (so the flexible
 * column is actually resizable), and the `ColumnResizeHandle` wiring.
 */
export function useGridColumns<K extends string>(options: {
  /** Full column order; width arrays are indexed by this. */
  keys: readonly K[];
  /** Columns currently shown, in display order. */
  visibleColumns: readonly K[];
  /** The column that fills remaining space (minmax(width, 1fr)). */
  flexibleKey: K;
  defaults: number[];
  min: number[];
  max: number[];
  storageKey: string;
  /** Fixed CSS tracks before the columns, e.g. ["28px"] for a checkbox. */
  prefixColumns?: string[];
  /** Fixed CSS tracks after the columns, e.g. extra fields as ["120px"]. */
  suffixColumns?: string[];
  /** Grid `gap` in px between tracks; used to size `minWidth`. */
  gap?: number;
}): {
  widths: number[];
  setWidths: Dispatch<SetStateAction<number[]>>;
  template: string;
  minWidth: number;
  resetWidths: () => void;
  resizeProps: (key: K) => ColumnResizeProps;
} {
  const {
    keys,
    visibleColumns,
    flexibleKey,
    defaults,
    min,
    max,
    storageKey,
    prefixColumns = [],
    suffixColumns = [],
    gap = 8,
  } = options;

  const [widths, setWidths] = useState(() =>
    storedNumbers(storageKey, defaults, min, max),
  );

  // Some grids reuse one component instance across scopes by swapping the
  // storage key (e.g. the scoped work-item views). Reload on key change, but
  // skip the initial run since useState already seeded from the first key.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setWidths(storedNumbers(storageKey, defaults, min, max));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(widths));
  }, [widths, storageKey]);

  const visibleColumnWidths = visibleColumns.map(
    (column) => widths[keys.indexOf(column)],
  );
  const flexibleIndex = Math.max(0, visibleColumns.indexOf(flexibleKey));
  const template = [
    gridColumnTemplate(visibleColumnWidths, flexibleIndex, prefixColumns),
    ...suffixColumns,
  ].join(" ");
  const minWidth = gridColumnsMinWidth(
    visibleColumnWidths,
    prefixColumns,
    suffixColumns,
    gap,
  );

  return {
    widths,
    setWidths,
    template,
    minWidth,
    resetWidths: () => setWidths([...defaults]),
    resizeProps: (key) => {
      const index = keys.indexOf(key);
      return {
        columnIndex: index,
        widths,
        setWidths,
        min: min[index],
        max: max[index],
        defaultWidth: defaults[index],
      };
    },
  };
}
