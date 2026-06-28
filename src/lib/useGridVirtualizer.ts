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

    function updateViewport() {
      setViewport({ height: element.clientHeight, scrollTop: element.scrollTop });
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
  }, [scrollerEl]);

  const firstRow = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - overscan);
  const visibleRowCount = Math.ceil(Math.max(viewport.height, rowHeight) / rowHeight);
  const lastRow = Math.min(rowCount, firstRow + visibleRowCount + overscan * 2);
  const topPadding = firstRow * rowHeight;
  const bottomPadding = Math.max(0, rowCount - lastRow) * rowHeight;

  // Scrolls the row at `index` just into view (no-op if already visible).
  const scrollRowIntoView = useCallback(
    (index: number) => {
      if (!scrollerEl) return;
      const rowTop = index * rowHeight;
      const rowBottom = rowTop + rowHeight;
      if (rowTop < scrollerEl.scrollTop) {
        scrollerEl.scrollTop = rowTop;
      } else if (rowBottom > scrollerEl.scrollTop + scrollerEl.clientHeight) {
        scrollerEl.scrollTop = rowBottom - scrollerEl.clientHeight;
      }
    },
    [scrollerEl, rowHeight],
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
