/**
 * Content-aware column sizing for the resizable grids (see useGridColumns).
 *
 * - `measureColumnContentWidths` reads the natural (untruncated) width of each
 *   visible column from the rendered header + body rows, so a column can be
 *   fitted to what it actually shows.
 * - `shrinkToFit` redistributes a width overflow so the flexible column (the
 *   title) keeps its space and the other columns give way first.
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
 * Width the cell would need to show its content without truncation: its own
 * scroll width plus whatever its truncated (overflow-clipped) descendants hide.
 */
export function naturalCellWidth(cell: HTMLElement): number {
  let hidden = 0;
  cell.querySelectorAll<HTMLElement>("*").forEach((el) => {
    const overflow = el.scrollWidth - el.clientWidth;
    if (overflow > 0 && getComputedStyle(el).overflowX !== "visible") hidden += overflow;
  });
  return cell.scrollWidth + hidden;
}

/**
 * Max natural width per visible column across all rendered rows. Columns with
 * no measurable cell come back as `null`. `trackOffset` skips fixed prefix
 * tracks (e.g. a checkbox column).
 */
export function measureColumnContentWidths(
  root: HTMLElement,
  trackOffset: number,
  count: number,
  { headerOnly = false }: { headerOnly?: boolean } = {},
): (number | null)[] {
  const result: (number | null)[] = Array.from({ length: count }, () => null);
  const rows = gridRows(root);
  for (const row of headerOnly ? rows.slice(0, 1) : rows) {
    const cells = rowCells(row);
    if (cells.length < trackOffset + count) continue;
    for (let i = 0; i < count; i += 1) {
      const width = naturalCellWidth(cells[trackOffset + i]);
      if (width > 0) result[i] = Math.max(result[i] ?? 0, width);
    }
  }
  return result;
}

/**
 * Removes `overflow` px from `widths`: first from the non-flexible columns in
 * proportion to their slack above `mins`, then from the flexible column. What
 * cannot be removed without going below the minimums stays (the grid scrolls).
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
  const others = next.map((_, i) => i).filter((i) => i !== flexibleIndex);
  const slack = others.reduce((sum, i) => sum + Math.max(0, next[i] - mins[i]), 0);
  if (slack > 0) {
    const take = Math.min(remaining, slack);
    for (const i of others) {
      const own = Math.max(0, next[i] - mins[i]);
      next[i] -= Math.floor((own / slack) * take);
    }
    remaining -= take;
  }
  if (remaining > 0 && flexibleIndex >= 0 && flexibleIndex < next.length) {
    const own = Math.max(0, next[flexibleIndex] - mins[flexibleIndex]);
    next[flexibleIndex] -= Math.min(own, remaining);
  }
  return next;
}
