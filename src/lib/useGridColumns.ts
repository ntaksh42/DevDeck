import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { clamp, gridColumnTemplate, gridColumnsMinWidth, storedNumbers } from "@/lib/utils";
import { gridRows, measureColumnContentWidths, shrinkToFit } from "@/lib/gridAutoFit";

export type ColumnResizeProps = {
  columnIndex: number;
  widths: number[];
  setWidths: Dispatch<SetStateAction<number[]>>;
  min: number;
  max: number;
  defaultWidth: number;
  /** Fits this column to its rendered content (double-click on the handle). */
  onAutoFit: () => void;
};

/**
 * Whether a grid's widths are auto-managed. Grids start in auto mode, and so
 * do users whose stored widths are still the untouched defaults; a manual
 * resize switches to manual until "Auto-fit widths" is chosen again.
 */
function readAutoMode(storageKey: string, defaults: number[]): boolean {
  const mode = localStorage.getItem(`${storageKey}:mode`);
  if (mode === "auto") return true;
  if (mode === "manual") return false;
  const stored = localStorage.getItem(storageKey);
  return !stored || stored === JSON.stringify(defaults);
}

/**
 * Shared column-width plumbing for the resizable, virtualized grids
 * (work items, reviews, commit search, PR search). Owns the width state, its
 * localStorage persistence, the `grid-template-columns` string, the wrapper
 * `minWidth` that lets the table grow past the viewport (so the flexible
 * column is actually resizable), and the `ColumnResizeHandle` wiring.
 *
 * Attach `gridRef` to the element wrapping the header and rows (the one sized
 * with `minWidth`). With it the hook also (a) sizes columns to their content
 * while in auto mode, (b) fits a single column on handle double-click, and
 * (c) when the pane is narrower than the columns, shrinks the non-flexible
 * columns first so the flexible one (the title) keeps its room.
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
  /** Returns to auto mode and re-fits the columns to their content. */
  resetWidths: () => void;
  gridRef: (element: HTMLElement | null) => void;
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
  const [autoMode, setAutoMode] = useState(() => readAutoMode(storageKey, defaults));
  const [gridElement, setGridElement] = useState<HTMLElement | null>(null);
  const [availableWidth, setAvailableWidth] = useState<number | null>(null);
  const autoFittedRef = useRef(false);
  // Natural header-label widths: the narrow-pane shrink never goes below them,
  // so column titles stay readable.
  const [headerFloors, setHeaderFloors] = useState<(number | null)[]>([]);

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
    setAutoMode(readAutoMode(storageKey, defaults));
    autoFittedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(widths));
  }, [widths, storageKey]);

  useEffect(() => {
    localStorage.setItem(`${storageKey}:mode`, autoMode ? "auto" : "manual");
  }, [autoMode, storageKey]);

  // Track the pane width (the scroll viewport around the grid, minus the row
  // padding) so the columns can give way before a horizontal scrollbar appears.
  useEffect(() => {
    const viewport = gridElement?.parentElement;
    if (!gridElement || !viewport || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const row = gridRows(gridElement)[0];
      const style = row ? getComputedStyle(row) : null;
      const padding = style
        ? (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
        : 0;
      setAvailableWidth(viewport.clientWidth - padding);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [gridElement]);

  const visibleKey = visibleColumns.join("|");
  const fitColumns = useCallback(
    (targets: readonly K[]) => {
      if (!gridElement) return false;
      const measured = measureColumnContentWidths(
        gridElement,
        prefixColumns.length,
        visibleColumns.length,
      );
      if (measured.every((width) => width === null)) return false;
      setWidths((prev) => {
        const next = [...prev];
        visibleColumns.forEach((column, visibleIndex) => {
          const width = measured[visibleIndex];
          if (width === null || !targets.includes(column)) return;
          const index = keys.indexOf(column);
          next[index] = clamp(Math.ceil(width) + 2, min[index], max[index]);
        });
        return next;
      });
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gridElement, visibleKey, prefixColumns.length],
  );

  useEffect(() => {
    autoFittedRef.current = false;
  }, [visibleKey]);

  // Auto mode: once body rows are on screen, size every non-flexible column to
  // its content. Re-arms when the grid empties (e.g. a new search) or the
  // visible columns change.
  useLayoutEffect(() => {
    if (!autoMode || !gridElement) return;
    const hasBodyRows = gridRows(gridElement).length > 1;
    if (!hasBodyRows) {
      autoFittedRef.current = false;
      return;
    }
    if (autoFittedRef.current) return;
    autoFittedRef.current = fitColumns(visibleColumns.filter((column) => column !== flexibleKey));
  });

  useLayoutEffect(() => {
    if (!gridElement) return;
    const measured = measureColumnContentWidths(
      gridElement,
      prefixColumns.length,
      visibleColumns.length,
      { headerOnly: true },
    ).map((width) => (width === null ? null : Math.ceil(width)));
    setHeaderFloors((prev) =>
      prev.length === measured.length && prev.every((width, i) => width === measured[i])
        ? prev
        : measured,
    );
  }, [gridElement, visibleKey, prefixColumns.length]);

  const setManualWidths: Dispatch<SetStateAction<number[]>> = useCallback((update) => {
    setAutoMode(false);
    setWidths(update);
  }, []);

  const storedVisibleWidths = visibleColumns.map(
    (column) => widths[keys.indexOf(column)],
  );
  const flexibleIndex = Math.max(0, visibleColumns.indexOf(flexibleKey));
  const requiredWidth = gridColumnsMinWidth(
    storedVisibleWidths,
    prefixColumns,
    suffixColumns,
    gap,
  );
  const visibleColumnWidths =
    availableWidth !== null && requiredWidth > availableWidth
      ? shrinkToFit(
          storedVisibleWidths,
          visibleColumns.map((column, i) =>
            Math.max(min[keys.indexOf(column)], headerFloors[i] ?? 0),
          ),
          flexibleIndex,
          requiredWidth - availableWidth,
        )
      : storedVisibleWidths;
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
    resetWidths: () => {
      setWidths([...defaults]);
      setAutoMode(true);
      autoFittedRef.current = false;
    },
    gridRef: setGridElement,
    resizeProps: (key) => {
      const index = keys.indexOf(key);
      return {
        columnIndex: index,
        widths,
        setWidths: setManualWidths,
        min: min[index],
        max: max[index],
        defaultWidth: defaults[index],
        onAutoFit: () => {
          setAutoMode(false);
          fitColumns([key]);
        },
      };
    },
  };
}
