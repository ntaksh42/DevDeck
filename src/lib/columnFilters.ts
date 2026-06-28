// Counts how many columns currently have an active filter. An absent key means
// "(All)"; an empty set means "uncheck all" (an explicit selection of nothing),
// so both are counted as an active column filter. Shared by the grids that
// support per-column value filters (My Reviews, PR search, Work Items).
export function activeColumnFilterCount<Col extends string>(
  filters: Partial<Record<Col, Set<string>>>,
): number {
  return (Object.values(filters) as (Set<string> | undefined)[]).filter(
    (values) => values !== undefined,
  ).length;
}

// The distinct values present for each filterable column, sorted, used to
// populate the per-column filter dropdown.
export function columnFilterUniqueValues<Item, Col extends string>(
  items: readonly Item[],
  filterable: Record<Col, (item: Item) => string>,
): Record<Col, string[]> {
  const map = {} as Record<Col, string[]>;
  for (const col of Object.keys(filterable) as Col[]) {
    map[col] = [...new Set(items.map(filterable[col]))].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }
  return map;
}

// Applies the active per-column filters to the items. An absent column key means
// "(All)"; an empty set means "none selected" (matches nothing). Returns the
// same array reference when no column filter is active so callers can rely on
// referential stability.
export function applyColumnFilters<Item, Col extends string>(
  items: Item[],
  filters: Partial<Record<Col, Set<string>>>,
  filterable: Record<Col, (item: Item) => string>,
): Item[] {
  const hasFilters = (Object.values(filters) as (Set<string> | undefined)[]).some(
    (values) => values !== undefined,
  );
  if (!hasFilters) return items;
  return items.filter((item) => {
    for (const col of Object.keys(filters) as Col[]) {
      const activeValues = filters[col];
      if (!activeValues) continue;
      if (!activeValues.has(filterable[col](item))) return false;
    }
    return true;
  });
}

// Toggles one value in a column's filter, preserving the "(All) = absent key"
// invariant: the first toggle off (All) deselects just that value, and checking
// every value again collapses back to "(All)".
export function toggleColumnFilterValue<Col extends string>(
  filters: Partial<Record<Col, Set<string>>>,
  col: Col,
  value: string,
  allValues: readonly string[],
): Partial<Record<Col, Set<string>>> {
  const current = filters[col];
  if (!current) {
    const next = new Set(allValues.filter((candidate) => candidate !== value));
    return { ...filters, [col]: next };
  }
  const next = new Set(current);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
    if (next.size === allValues.length) {
      const cleared = { ...filters };
      delete cleared[col];
      return cleared;
    }
  }
  return { ...filters, [col]: next };
}
