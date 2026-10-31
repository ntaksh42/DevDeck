import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { clamp, gridColumnTemplate, gridColumnsMinWidth, storedNumbers } from "@/lib/utils";
import {
  gridRows,
  hideColumnsToFit,
  measureColumnContentWidths,
  mutatedGridRows,
  shrinkToFit,
} from "@/lib/gridAutoFit";

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

/** How far the flexible column (the title) may shrink in a narrow pane. */
const FLEXIBLE_SHRINK_FLOOR = 200;

/**
 * Whether a grid's widths are auto-managed. Grids start in auto mode, and so
 * do users whose stored widths are still the untouched defaults; a manual
 * resize switches to manual until the status bar's "Fit" is chosen again.
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
 * (c) when the pane is narrower than the columns, hides the `autoHide`
 * columns in order until they fit, then shrinks the flexible column (the
 * title) first so the short columns keep their content readable.
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
  /** Columns hidden first-to-last while the pane is too narrow for the rest. */
  autoHide?: readonly K[];
}): {
  widths: number[];
  setWidths: Dispatch<SetStateAction<number[]>>;
  /** `visibleColumns` minus those auto-hidden for width; render these. */
  shownColumns: K[];
  template: string;
  minWidth: number;
  /** True while widths follow the content (no manual resize since the last fit). */
  autoWidths: boolean;
  /** Returns to auto mode and re-fits the columns to their content. */
  resetWidths: () => void;
  gridRef: (element: HTMLElement | null) => void;
  resizeProps: (key: K) => ColumnResizeProps;
} {
  const {
    keys,
    visibleColumns: requestedColumns,
    flexibleKey,
    defaults,
    min,
    max,
    storageKey,
    prefixColumns = [],
    suffixColumns = [],
    gap = 8,
    autoHide = [],
  } = options;

  const [widths, setWidths] = useState(() =>
    storedNumbers(storageKey, defaults, min, max),
  );
  const [autoMode, setAutoMode] = useState(() => readAutoMode(storageKey, defaults));
  const [gridElement, setGridElement] = useState<HTMLElement | null>(null);
  const [availableWidth, setAvailableWidth] = useState<number | null>(null);
  // Display only: the user's column choice is untouched and the hidden
  // columns return when the pane widens.
  const visibleColumns = hideColumnsToFit(
    requestedColumns,
    autoHide,
    availableWidth,
    (columns) =>
      gridColumnsMinWidth(
        columns.map((column) => {
          const width = widths[keys.indexOf(column)];
          return column === flexibleKey ? Math.min(width, FLEXIBLE_SHRINK_FLOOR) : width;
        }),
        prefixColumns,
        suffixColumns,
        gap,
      ),
  );
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
  // hideColumnsToFit returns a new array on every render. Keep one identity per
  // column set: the rows are memoized on it, and a fresh array re-rendered
  // every visible row on every scroll event.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shownColumns = useMemo(() => visibleColumns, [visibleKey]);
  const fitColumns = useCallback(
    (
      targets: readonly K[],
      { growOnly = false, rows }: { growOnly?: boolean; rows?: HTMLElement[] } = {},
    ) => {
      if (!gridElement) return false;
      const measured = measureColumnContentWidths(
        gridElement,
        prefixColumns.length,
        visibleColumns.length,
        { rows },
      );
      if (measured.every((width) => width === null)) return false;
      setWidths((prev) => {
        const next = [...prev];
        visibleColumns.forEach((column, visibleIndex) => {
          const width = measured[visibleIndex];
          if (width === null || !targets.includes(column)) return;
          const index = keys.indexOf(column);
          const fitted = clamp(Math.ceil(width) + 2, min[index], max[index]);
          next[index] = growOnly ? Math.max(prev[index], fitted) : fitted;
        });
        return next.every((width, i) => width === prev[i]) ? prev : next;
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

  // Auto mode: rows that appear later (group expanded, sync, scrolled into the
  // window) widen a column when their content needs it. Grow-only, so scrolling
  // past shorter rows does not make the columns jump back and forth.
  useEffect(() => {
    if (!autoMode || !gridElement || typeof MutationObserver === "undefined") return;
    let frame = 0;
    // Grow-only, so only the rows that just appeared or changed can widen a
    // column; measuring every rendered row forced a layout per scrolled row.
    let pending = new Set<HTMLElement>();
    const observer = new MutationObserver((records) => {
      mutatedGridRows(records).forEach((row) => pending.add(row));
      if (pending.size === 0) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rows = [...pending].filter((row) => row.isConnected);
        pending = new Set();
        if (!autoFittedRef.current || rows.length === 0) return;
        fitColumns(
          visibleColumns.filter((column) => column !== flexibleKey),
          { growOnly: true, rows },
        );
      });
    });
    observer.observe(gridElement, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMode, gridElement, fitColumns, flexibleKey]);

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
            Math.max(
              column === flexibleKey ? FLEXIBLE_SHRINK_FLOOR : min[keys.indexOf(column)],
              headerFloors[i] ?? 0,
            ),
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
    shownColumns,
    template,
    minWidth,
    autoWidths: autoMode,
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
