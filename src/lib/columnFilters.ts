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
