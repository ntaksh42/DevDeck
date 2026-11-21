import type { PrSearchDateBasis, PrSearchSortBy, PrSearchStatus } from './PrSearchTypes';

export type PrSearchPerson = { id: string; displayName: string; uniqueName?: string | null };

/** Everything a PR search needs besides its text, so it can be re-run later. */
export type PrSearchFilters = {
  statuses: PrSearchStatus[];
  projectIds: string[];
  repositoryIds: string[];
  targetBranches: string[];
  fromDate: string;
  toDate: string;
  dateBasis: PrSearchDateBasis;
  sortBy: PrSearchSortBy;
  excludeDrafts: boolean;
  author?: PrSearchPerson | null;
  reviewer?: PrSearchPerson | null;
  excludeWords?: string;
};

export function normalizePrSearchFilters(filters: PrSearchFilters): PrSearchFilters {
  return { ...filters, author: filters.author ?? null, reviewer: filters.reviewer ?? null, excludeWords: filters.excludeWords ?? "" };
}

/** One-line description of the non-default filters, e.g. "active · 2 repos · no drafts". */
export function summarizePrSearchFilters(f: PrSearchFilters): string {
  const parts: string[] = [];
  parts.push(f.statuses.length > 0 ? f.statuses.join("/") : "all statuses");
  if (f.projectIds.length > 0) parts.push(`${f.projectIds.length} project${f.projectIds.length === 1 ? "" : "s"}`);
  if (f.repositoryIds.length > 0) parts.push(`${f.repositoryIds.length} repo${f.repositoryIds.length === 1 ? "" : "s"}`);
  if (f.targetBranches.length > 0) parts.push(f.targetBranches.length === 1 ? f.targetBranches[0] : `${f.targetBranches.length} branches`);
  if (f.fromDate || f.toDate) parts.push(`${f.fromDate || "…"} – ${f.toDate || "…"}`);
  if (f.excludeDrafts) parts.push("no drafts");
  if (f.author) parts.push(`author: ${f.author.displayName}`);
  if (f.reviewer) parts.push(`reviewer: ${f.reviewer.displayName}`);
  if (f.excludeWords) parts.push(`exclude: ${f.excludeWords}`);
  return parts.join(" · ");
}
