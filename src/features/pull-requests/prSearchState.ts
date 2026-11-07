import type { PullRequestSummary, SearchPullRequestsInput } from "@/lib/azdoCommands";
import { loadPrSearchDateBasis, loadPrSearchSortBy, loadPrSearchStatuses, type PrSearchSortBy } from "./PrSearchTypes";
import type { PrSearchFilters } from "./prSearchHistoryHelpers";

export function initialPrSearchFilters(): PrSearchFilters {
  return { statuses: loadPrSearchStatuses(), projectIds: [], repositoryIds: [], targetBranches: [], fromDate: "", toDate: "", dateBasis: loadPrSearchDateBasis(), sortBy: loadPrSearchSortBy(), excludeDrafts: false, author: null, reviewer: null, excludeWords: "" };
}

export function prSearchInput(query: string, filters: PrSearchFilters): SearchPullRequestsInput {
  return {
    query, statuses: filters.statuses,
    projectIds: filters.projectIds.length ? filters.projectIds : undefined,
    repositoryIds: filters.repositoryIds.length ? filters.repositoryIds : undefined,
    targetBranches: filters.targetBranches.length ? filters.targetBranches : undefined,
    fromDate: filters.fromDate || undefined, toDate: filters.toDate || undefined,
    dateBasis: filters.dateBasis, sortBy: filters.sortBy, excludeDrafts: filters.excludeDrafts || undefined,
    authorId: filters.author?.id, reviewerId: filters.reviewer?.id, excludeWords: filters.excludeWords || undefined,
  };
}

export function prSearchKey(pr: PullRequestSummary): string {
  return `${pr.organizationId}:${pr.repositoryId}:${pr.pullRequestId}`;
}

export function sortPrSearchRows(rows: PullRequestSummary[], sort: PrSearchSortBy): PullRequestSummary[] {
  return [...rows].sort((a, b) => {
    const value = sort === "title" ? a.title.toLowerCase().localeCompare(b.title.toLowerCase())
      : sort === "closed" ? (b.closedDate ?? "").localeCompare(a.closedDate ?? "") || b.creationDate.localeCompare(a.creationDate)
        : b.creationDate.localeCompare(a.creationDate);
    return value || prSearchKey(a).localeCompare(prSearchKey(b));
  });
}
