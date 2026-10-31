import { useCallback, useEffect, useState } from "react";

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
  scrollRowIntoView: (index: number) => void;
} {
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ height: 0, scrollTop: 0 });

  useEffect(() => {
    if (!scrollerEl) return;
    const element = scrollerEl;

    // The window only moves a whole row at a time; skip re-rendering the
    // owner on every scrolled pixel while the top row stays the same.
    function updateViewport() {
      const height = element.clientHeight;
      const scrollTop = snapToRow(element.scrollTop, rowHeight);
      setViewport((prev) =>
        prev.height === height && prev.scrollTop === scrollTop ? prev : { height, scrollTop },
      );
    }

    updateViewport();
    element.addEventListener("scroll", updateViewport, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateViewport);
    resizeObserver?.observe(element);
    return () => {
      element.removeEventListener("scroll", updateViewport);
      resizeObserver?.disconnect();
    };
  }, [scrollerEl, rowHeight]);

  const firstRow = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - overscan);
  const visibleRowCount = Math.ceil(Math.max(viewport.height, rowHeight) / rowHeight);
  const lastRow = Math.min(rowCount, firstRow + visibleRowCount + overscan * 2);
  const topPadding = firstRow * rowHeight;
  const bottomPadding = Math.max(0, rowCount - lastRow) * rowHeight;

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
    scrollRowIntoView,
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
