// Colours for overlaid series.
//
// Assigned by position within the group rather than stored per member, so a
// member keeps a stable colour without the user having to pick one, and the
// palette cannot drift out of sync with the theme.

const QUERY_COLORS = [
  "hsl(210 84% 50%)",
  "hsl(271 65% 55%)",
  "hsl(340 75% 50%)",
  "hsl(25 90% 47%)",
  "hsl(173 70% 35%)",
  "hsl(48 90% 40%)",
] as const;

const BRANCH_COLORS = [
  "hsl(199 80% 42%)",
  "hsl(291 55% 52%)",
  "hsl(15 80% 50%)",
  "hsl(158 60% 35%)",
] as const;

export function querySeriesColor(index: number): string {
  return QUERY_COLORS[index % QUERY_COLORS.length];
}

export function branchSeriesColor(index: number): string {
  return BRANCH_COLORS[index % BRANCH_COLORS.length];
}
