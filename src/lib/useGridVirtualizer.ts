import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

// Fixed-row-height windowing for the grids that virtualize their rows (My
// Reviews, PR search). Owns the scroll container element via a callback ref,
// tracks its viewport (height + scrollTop) through scroll and resize, and
// derives the slice of rows to render plus the top/bottom spacer heights.
//
// `rowCount` is the number of *rendered* rows (e.g. My Reviews counts section
// headers too), so callers slice their own row array by [firstRow, lastRow).
export function useGridVirtualizer({
  rowCount,
  rowHeight,
  overscan,
}: {
  rowCount: number;
  rowHeight: number;
  overscan: number;
}): {
  scrollerRef: (element: HTMLDivElement | null) => void;
  scrollerEl: HTMLDivElement | null;
  firstRow: number;
  lastRow: number;
  topPadding: number;
  bottomPadding: number;
  totalHeight: number;
  scrollRowIntoView: (index: number) => void;
} {
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);
  const { firstRow, lastRow, topPadding, bottomPadding, totalHeight } = useVirtualRowWindow(scrollerEl, {
    rowCount,
    rowHeight,
    overscan,
  });

  // Scrolls the row at `index` just into view (no-op if already visible).
  const scrollRowIntoView = useCallback(
    (index: number) => {
      if (scrollerEl) scrollGridRowIntoView(scrollerEl, index, rowHeight, rowCount);
    },
    [scrollerEl, rowHeight, rowCount],
  );

  return {
    scrollerRef: setScrollerEl,
    scrollerEl,
    firstRow,
    lastRow,
    topPadding,
    bottomPadding,
    totalHeight,
    scrollRowIntoView,
  };
}

/**
 * The slice of fixed-height rows to render for `scroller`'s current viewport.
 *
 * Call it from the component that renders the rows, not from a grid's owner:
 * the scroll state lives here, so each window move re-renders only the caller.
 * Holding it in the owner re-rendered the header, status bar, preview, and the
 * dock panels on every row scrolled, which made fast scrolling stutter.
 */
export function useVirtualRowWindow(
  scroller: HTMLElement | null,
  { rowCount, rowHeight, overscan }: { rowCount: number; rowHeight: number; overscan: number },
): {
  /** Visible width of the scroller. */
  width: number;
  firstRow: number;
  lastRow: number;
  topPadding: number;
  bottomPadding: number;
  /**
   * Height of all rows. Set it as `minHeight` on the element holding the
   * spacers and rows, so the scroll height never dips while React swaps the
   * window. Chromium lays out mid-commit when the focused row is removed, and
   * with the bottom spacer not yet in place it clamps the scroll position.
   */
  totalHeight: number;
} {
  const [viewport, setViewport] = useState({ width: 0, height: 0, scrollTop: 0 });
  const renderedViewport = useRef(viewport);
  useLayoutEffect(() => {
    renderedViewport.current = viewport;
  }, [viewport]);

  useEffect(() => {
    if (!scroller) return;
    const element = scroller;

    // The window only moves a whole row at a time; skip re-rendering on every
    // scrolled pixel while the top row stays the same.
    function updateViewport(scrolling = false) {
      const next = {
        width: element.clientWidth,
        height: element.clientHeight,
        scrollTop: snapToRow(element.scrollTop, rowHeight),
      };
      const update = () => {
        setViewport((prev) =>
          prev.width === next.width && prev.height === next.height && prev.scrollTop === next.scrollTop
            ? prev
            : next,
        );
      };
      // A deferred update can leave a fast scroll outside the mounted rows for
      // a paint. Flush only when movement since the last *commit* consumes the
      // overscan, keeping one row of slack for rounding and the column header.
      // Small scrolls stay batched, and mounting/resizing never flushes effects.
      if (
        scrolling && Math.abs(next.scrollTop - renderedViewport.current.scrollTop)
          > Math.max(0, overscan - 1) * rowHeight
      ) {
        flushSync(update);
      } else {
        update();
      }
    }

    const handleScroll = () => updateViewport(true);

    updateViewport();
    element.addEventListener("scroll", handleScroll, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => updateViewport());
    resizeObserver?.observe(element);
    return () => {
      element.removeEventListener("scroll", handleScroll);
      resizeObserver?.disconnect();
    };
  }, [scroller, rowHeight, overscan]);

  const firstRow = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - overscan);
  const visibleRowCount = Math.ceil(Math.max(viewport.height, rowHeight) / rowHeight);
  const lastRow = Math.min(rowCount, firstRow + visibleRowCount + overscan * 2);
  return {
    width: viewport.width,
    firstRow,
    lastRow,
    topPadding: firstRow * rowHeight,
    bottomPadding: Math.max(0, rowCount - lastRow) * rowHeight,
    totalHeight: rowCount * rowHeight,
  };
}

/**
 * Scrolls a fixed-height virtualized row just into view (no-op if visible).
 *
 * Rows usually sit below a column header that scrolls with them, so a row's
 * position is the header height plus `index * rowHeight`. The header height is
 * whatever the scroller holds besides the rows; without it, End stops short and
 * leaves the last row partly cut off.
 */
export function scrollGridRowIntoView(
  scroller: HTMLElement,
  index: number,
  rowHeight: number,
  rowCount: number,
): void {
  const headerHeight = Math.max(0, scroller.scrollHeight - rowCount * rowHeight);
  const rowBottom = headerHeight + (index + 1) * rowHeight;
  // Scrolling up keeps the old target (index * rowHeight), which leaves a
  // header-height of context above the row and shows the header on Home.
  if (headerHeight + index * rowHeight < scroller.scrollTop) {
    scroller.scrollTop = index * rowHeight;
  } else if (rowBottom > scroller.scrollTop + scroller.clientHeight) {
    scroller.scrollTop = rowBottom - scroller.clientHeight;
  }
}

/** Rounds a scroll offset down to the top of its row. */
export function snapToRow(scrollTop: number, rowHeight: number): number {
  return Math.floor(scrollTop / rowHeight) * rowHeight;
}
