import type { SortDirection } from "@/lib/utils";

const PR_VIEWS_STORAGE_KEY = "azdodeck:pullRequestViews";
const PR_VIEWS_EXPORT_SCHEMA = "azdodeck.pullRequestViews";

// Columns the review grid lets the user filter on. Kept in sync with
// MyReviewsGrid's FilterableColumn so a saved view restores the same filters.
export const PR_VIEW_FILTERABLE_COLUMNS = [
  "repositoryName",
  "createdBy",
  "targetRefName",
  "myIsRequired",
  "myVote",
] as const;
export type PrViewFilterableColumn = (typeof PR_VIEW_FILTERABLE_COLUMNS)[number];

// Sort keys the review grid offers. Kept in sync with MyReviewsGrid's SortKey.
const PR_VIEW_SORT_KEYS = [
  "pullRequestId",
  "ciStatus",
  "repositoryName",
  "title",
  "createdBy",
  "creationDate",
  "targetRefName",
  "myIsRequired",
  "myVote",
] as const;
export type PrViewSortKey = (typeof PR_VIEW_SORT_KEYS)[number];

export type PullRequestView = {
  id: string;
  name: string;
  pinned?: boolean;
  // Empty / undefined means "use the grid's current organization".
  organizationId?: string;
  textFilter: string;
  // Each entry is a set of allowed values for that column (allow-list).
  columnFilters: Partial<Record<PrViewFilterableColumn, string[]>>;
  showDrafts: boolean;
  sortKey: PrViewSortKey;
  sortDirection: SortDirection;
};

export type PullRequestViewsExport = {
  schema: typeof PR_VIEWS_EXPORT_SCHEMA;
  version: 1;
  exportedAt: string;
  views: PullRequestView[];
};

function isSortKey(value: unknown): value is PrViewSortKey {
  return PR_VIEW_SORT_KEYS.includes(value as PrViewSortKey);
}

function normalizeColumnFilters(
  value: unknown,
): Partial<Record<PrViewFilterableColumn, string[]>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Partial<Record<PrViewFilterableColumn, string[]>> = {};
  for (const column of PR_VIEW_FILTERABLE_COLUMNS) {
    const values = (value as Record<string, unknown>)[column];
    if (!Array.isArray(values)) continue;
    const cleaned = values.filter((entry): entry is string => typeof entry === "string");
    if (cleaned.length > 0) result[column] = [...new Set(cleaned)];
  }
  return result;
}

export function normalizePullRequestView(value: unknown): PullRequestView | null {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as PullRequestView).id !== "string" ||
    typeof (value as PullRequestView).name !== "string"
  ) {
    return null;
  }
  const view = value as PullRequestView;
  return {
    id: view.id,
    name: view.name,
    pinned: view.pinned === true,
    organizationId: typeof view.organizationId === "string" ? view.organizationId : undefined,
    textFilter: typeof view.textFilter === "string" ? view.textFilter : "",
    columnFilters: normalizeColumnFilters(view.columnFilters),
    showDrafts: view.showDrafts === true,
    sortKey: isSortKey(view.sortKey) ? view.sortKey : "creationDate",
    sortDirection: view.sortDirection === "asc" ? "asc" : "desc",
  };
}

export function loadPullRequestViews(): PullRequestView[] {
  if (typeof window === "undefined") return [];
  const value = window.localStorage.getItem(PR_VIEWS_STORAGE_KEY);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizePullRequestView)
      .filter((view): view is PullRequestView => view !== null);
  } catch {
    return [];
  }
}

export function savePullRequestViews(views: PullRequestView[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PR_VIEWS_STORAGE_KEY, JSON.stringify(views));
}

export function createPullRequestViewsExport(
  views: PullRequestView[],
): PullRequestViewsExport {
  return {
    schema: PR_VIEWS_EXPORT_SCHEMA,
    version: 1,
    exportedAt: new Date().toISOString(),
    views,
  };
}

export function parsePullRequestViewsImport(text: string): PullRequestView[] {
  const parsed = JSON.parse(text);
  const rawViews: unknown[] | null = Array.isArray(parsed)
    ? parsed
    : parsed?.schema === PR_VIEWS_EXPORT_SCHEMA && Array.isArray(parsed.views)
      ? parsed.views
      : null;
  if (!rawViews) {
    throw new Error("JSON must be an AzDoDeck pull request view export.");
  }
  const views = rawViews
    .map(normalizePullRequestView)
    .filter((view): view is PullRequestView => view !== null);
  if (views.length === 0) {
    throw new Error("No valid pull request views found in JSON.");
  }
  return views;
}

export function newPullRequestViewId(): string {
  return `pr-view-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
