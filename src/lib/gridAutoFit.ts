/**
 * Content-aware column sizing for the resizable grids (see useGridColumns).
 *
 * - `measureColumnContentWidths` reads the natural (untruncated) width of each
 *   visible column from the rendered header + body rows, so a column can be
 *   fitted to what it actually shows.
 * - `shrinkToFit` removes a width overflow from the flexible column (the title)
 *   first, so the short columns keep their content readable.
 * - `hideColumnsToFit` drops low-priority columns while the pane is too narrow.
 */

/** Rows are the elements the grids lay out with an inline grid template. */
const ROW_SELECTOR = '[style*="grid-template-columns"]';

export function gridRows(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(ROW_SELECTOR));
}

/** Grid items of a row, skipping absolutely positioned decorations. */
function rowCells(row: HTMLElement): HTMLElement[] {
  return Array.from(row.children).filter((child): child is HTMLElement => {
    if (!(child instanceof HTMLElement)) return false;
    const position = getComputedStyle(child).position;
    return position !== "absolute" && position !== "fixed";
  });
}

/**
 * Max natural width per visible column across all rendered rows. Columns with
 * no measurable cell come back as `null`. `trackOffset` skips fixed prefix
 * tracks (e.g. a checkbox column).
 *
 * Each cell is briefly sized to its own `max-content`, so the reading does not
 * depend on the column's current track width. A stretched cell can never read
 * narrower than its track (and a header's absolutely positioned resize handle
 * pokes past its right edge), which made every fit grow the column a little.
 * The inline width is restored before returning, so nothing paints in between.
 */
export function measureColumnContentWidths(
  root: HTMLElement,
  trackOffset: number,
  count: number,
  { headerOnly = false }: { headerOnly?: boolean } = {},
): (number | null)[] {
  const result: (number | null)[] = Array.from({ length: count }, () => null);
  const rows = gridRows(root);
  const measuredRows = (headerOnly ? rows.slice(0, 1) : rows)
    .map(rowCells)
    .filter((cells) => cells.length >= trackOffset + count)
    .map((cells) => cells.slice(trackOffset, trackOffset + count));
  const cells = measuredRows.flat();
  const savedWidths = cells.map((cell) => cell.style.width);
  cells.forEach((cell) => {
    cell.style.width = "max-content";
  });
  try {
    for (const row of measuredRows) {
      row.forEach((cell, i) => {
        const width = cell.getBoundingClientRect().width;
        if (width > 0) result[i] = Math.max(result[i] ?? 0, width);
      });
    }
  } finally {
    cells.forEach((cell, i) => {
      cell.style.width = savedWidths[i];
    });
  }
  return result;
}

/**
 * Removes `overflow` px from `widths`: first from the flexible column, then
 * from the others in proportion to their slack above `mins`. What cannot be
 * removed without going below the minimums stays (the grid scrolls).
 */
export function shrinkToFit(
  widths: number[],
  mins: number[],
  flexibleIndex: number,
  overflow: number,
): number[] {
  if (overflow <= 0) return widths;
  const next = [...widths];
  let remaining = overflow;
  if (flexibleIndex >= 0 && flexibleIndex < next.length) {
    const own = Math.max(0, next[flexibleIndex] - mins[flexibleIndex]);
    const take = Math.min(own, remaining);
    next[flexibleIndex] -= take;
    remaining -= take;
  }
  const others = next.map((_, i) => i).filter((i) => i !== flexibleIndex);
  const slack = others.reduce((sum, i) => sum + Math.max(0, next[i] - mins[i]), 0);
  if (remaining > 0 && slack > 0) {
    const take = Math.min(remaining, slack);
    for (const i of others) {
      const own = Math.max(0, next[i] - mins[i]);
      next[i] -= Math.floor((own / slack) * take);
    }
  }
  return next;
}

/**
 * Drops `hideOrder` columns, first to last, until `widthOf` the rest fits in
 * `available`. A null `available` (pane not measured yet) hides nothing.
 */
export function hideColumnsToFit<K>(
  columns: readonly K[],
  hideOrder: readonly K[],
  available: number | null,
  widthOf: (columns: K[]) => number,
): K[] {
  let shown = [...columns];
  for (const hide of hideOrder) {
    if (available === null || widthOf(shown) <= available) break;
    shown = shown.filter((column) => column !== hide);
  }
  return shown;
}
