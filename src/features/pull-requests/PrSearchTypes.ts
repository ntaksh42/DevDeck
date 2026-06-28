import {
  type PullRequestSummary,
  type ReviewPullRequestSummary,
  type SearchPullRequestsInput,
} from '@/lib/azdoCommands';

export const DEFAULT_PR_SEARCH_PREVIEW_WIDTH = 460;
export const MIN_PR_SEARCH_PREVIEW_WIDTH = 320;
export const MAX_PR_SEARCH_PREVIEW_WIDTH = 8192;
export const PR_SEARCH_PREVIEW_WIDTH_STORAGE_KEY = 'azdodeck:layout:prSearchPreviewWidth';

// Adapts a search result to the shape PrReviewPanel needs; the panel refetches
// the real review (vote/reviewers/threads) by locator, so these are defaults.
export function toReviewSummary(pr: PullRequestSummary): ReviewPullRequestSummary {
  return {
    ...pr,
    myVote: 0,
    myVoteLabel: "No Vote",
    myIsRequired: false,
    isDraft: false,
    mergeStatus: null,
    ciStatus: null,
    ciContext: null,
    ciCheckCount: 0,
  };
}

export const DEFAULT_PR_SEARCH_COLUMN_WIDTHS = [56, 70, 220, 130, 104, 64, 120];
export const PR_SEARCH_COLUMN_MIN_WIDTHS = [52, 64, 160, 104, 86, 58, 100];
export const PR_SEARCH_COLUMN_MAX_WIDTHS = [120, 140, 720, 360, 280, 120, 360];
export const PR_SEARCH_COLUMN_WIDTHS_STORAGE_KEY = 'azdodeck:layout:prSearchGridColumnWidths:v2';
export const PR_SEARCH_QUERY_STORAGE_KEY = 'azdodeck:view:prSearchQuery';
export const PR_SEARCH_ROW_HEIGHT = 29;
export const PR_SEARCH_OVERSCAN = 8;
export type PrSearchFilterableColumn = "status" | "repository" | "createdBy" | "branch";

export type PrSearchStatus = NonNullable<SearchPullRequestsInput["statuses"]>[number];

// Active PRs come from the local cache; the other statuses are fetched live from
// Azure DevOps by prs.rs search() because completed/abandoned history is too
// large to sync. The note under the form explains the difference.
export const PR_SEARCH_STATUS_OPTIONS: { value: PrSearchStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "abandoned", label: "Abandoned" },
];
export const PR_SEARCH_STATUS_STORAGE_KEY = "azdodeck:view:prSearchStatuses";

export function loadPrSearchStatuses(): PrSearchStatus[] {
  const valid = new Set(PR_SEARCH_STATUS_OPTIONS.map((option) => option.value));
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(PR_SEARCH_STATUS_STORAGE_KEY) ?? "null",
    );
    if (Array.isArray(parsed)) {
      const kept = parsed.filter((value): value is PrSearchStatus => valid.has(value));
      if (kept.length > 0) return kept;
    }
  } catch {
    // Ignore malformed storage and fall back to the default below.
  }
  return ["active"];
}

export type PrSearchDateBasis = NonNullable<SearchPullRequestsInput["dateBasis"]>;
export const PR_SEARCH_DATE_BASIS_OPTIONS: { value: PrSearchDateBasis; label: string }[] = [
  { value: "created", label: "Created date" },
  { value: "closed", label: "Closed date" },
];
export const PR_SEARCH_DATE_BASIS_STORAGE_KEY = "azdodeck:view:prSearchDateBasis";

export function loadPrSearchDateBasis(): PrSearchDateBasis {
  const stored = window.localStorage.getItem(PR_SEARCH_DATE_BASIS_STORAGE_KEY);
  return PR_SEARCH_DATE_BASIS_OPTIONS.some((option) => option.value === stored)
    ? (stored as PrSearchDateBasis)
    : "created";
}

export type PrSearchSortBy = NonNullable<SearchPullRequestsInput["sortBy"]>;
export const PR_SEARCH_SORT_OPTIONS: { value: PrSearchSortBy; label: string }[] = [
  { value: "created", label: "Newest created" },
  { value: "closed", label: "Recently closed" },
  { value: "title", label: "Title (A–Z)" },
];
export const PR_SEARCH_SORT_STORAGE_KEY = "azdodeck:view:prSearchSort";

export function loadPrSearchSortBy(): PrSearchSortBy {
  const stored = window.localStorage.getItem(PR_SEARCH_SORT_STORAGE_KEY);
  return PR_SEARCH_SORT_OPTIONS.some((option) => option.value === stored)
    ? (stored as PrSearchSortBy)
    : "created";
}

export const PR_SEARCH_FILTERABLE_COLUMNS: Record<PrSearchFilterableColumn, (pr: PullRequestSummary) => string> = {
  status: (pr) => pr.status,
  repository: (pr) => `${pr.projectName} / ${pr.repositoryName}`,
  createdBy: (pr) => pr.createdBy ?? "Unknown",
  branch: (pr) => `${pr.sourceRefName} -> ${pr.targetRefName}`,
};

export type PrSearchColumnKey =
  | "pullRequestId"
  | "status"
  | "title"
  | "repository"
  | "author"
  | "date"
  | "branch";
export const PR_SEARCH_KEYS: PrSearchColumnKey[] = [
  "pullRequestId",
  "status",
  "title",
  "repository",
  "author",
  "date",
  "branch",
];
export const PR_SEARCH_COLUMN_LABELS: Record<PrSearchColumnKey, string> = {
  pullRequestId: "PR#",
  status: "Status",
  title: "Title",
  repository: "Repository",
  author: "Author",
  date: "Date",
  branch: "Branch",
};
export const PR_SEARCH_REQUIRED_COLUMNS: PrSearchColumnKey[] = ["pullRequestId", "title"];
export const PR_SEARCH_COLUMN_FILTER_KEY: Partial<Record<PrSearchColumnKey, PrSearchFilterableColumn>> = {
  status: "status",
  repository: "repository",
  author: "createdBy",
  branch: "branch",
};
export const PR_SEARCH_VISIBLE_COLUMNS_STORAGE_KEY = "azdodeck:layout:prSearchVisibleColumns:v1";

export const PR_STATUS_COLORS: Record<string, string> = {
  active: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900",
  completed: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900",
  abandoned: "bg-gray-50 text-gray-500 border-gray-200 dark:bg-muted dark:text-muted-foreground dark:border-border",
};
