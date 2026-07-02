// Column order mirrors the width arrays below: sha, date, comment, repository,
// author, pr. SHA and the message stay required so the grid is never blank.
export type CommitColumnKey = "sha" | "date" | "comment" | "repository" | "author" | "pr";
export const COMMIT_COLUMN_KEYS: CommitColumnKey[] = [
  "sha",
  "date",
  "comment",
  "repository",
  "author",
  "pr",
];
export const COMMIT_COLUMN_LABELS: Record<CommitColumnKey, string> = {
  sha: "SHA",
  date: "Date",
  comment: "Message",
  repository: "Repository",
  author: "Author",
  pr: "PR",
};
export const COMMIT_REQUIRED_COLUMNS: CommitColumnKey[] = ["sha", "comment"];

export const DEFAULT_COMMIT_PREVIEW_WIDTH = 460;
export const MIN_COMMIT_PREVIEW_WIDTH = 320;
export const MAX_COMMIT_PREVIEW_WIDTH = 8192;
export const COMMIT_PREVIEW_WIDTH_STORAGE_KEY = "azdodeck:layout:commitPreviewWidth";

export const DEFAULT_COMMIT_COLUMN_WIDTHS = [72, 80, 220, 140, 120, 44];
export const COMMIT_COLUMN_MIN_WIDTHS = [66, 72, 160, 110, 96, 40];
export const COMMIT_COLUMN_MAX_WIDTHS = [140, 160, 720, 380, 340, 72];
export const COMMIT_COLUMN_WIDTHS_STORAGE_KEY = "azdodeck:layout:commitGridColumnWidths:v3";
export const COMMIT_SEARCH_VIEW_STORAGE_KEY = "azdodeck:view:commitSearch:v1";
export const COMMIT_VIEW_MODE_STORAGE_KEY = "azdodeck:view:commitViewMode:v1";
export const COMMIT_SORT_STORAGE_KEY = "azdodeck:view:commitGridSort:v1";
export const COMMIT_VISIBLE_COLUMNS_STORAGE_KEY = "azdodeck:layout:commitVisibleColumns:v1";
export const COMMIT_GRID_ROW_HEIGHT = 29;
export const COMMIT_GRID_OVERSCAN = 8;

export type CommitSearchViewState = {
  author: string;
  branch: string;
  fromDate: string;
  organizationId: string;
  projectIds: string[];
  repositoryIds: string[];
  toDate: string;
};

export type CommitViewMode = "results" | "activity";

export type CommitSortKey = "date" | "repository" | "author" | "comment";
export type CommitSortState = { key: CommitSortKey; direction: "asc" | "desc" };

export const PR_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  completed: "Completed",
  abandoned: "Abandoned",
};

export const commitSortLabels: Record<CommitSortKey, string> = {
  date: "Date",
  comment: "Message",
  repository: "Repository",
  author: "Author",
};

export const COMMIT_GRID_KEYS: CommitSortKey[] = ["date", "comment", "repository", "author"];
