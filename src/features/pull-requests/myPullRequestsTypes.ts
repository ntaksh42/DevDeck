import type { SortDirection } from "@/lib/utils";
import type { MyCreatedPullRequestSummary } from "@/lib/azdoCommands";

export type SortKey =
  | "pullRequestId"
  | "repositoryName"
  | "title"
  | "creationDate"
  | "targetRefName"
  | "approvals";

export type SortState = { key: SortKey; direction: SortDirection };

export const sortLabels: Record<SortKey, string> = {
  pullRequestId: "PR#",
  repositoryName: "Repository",
  title: "Title",
  creationDate: "Created",
  targetRefName: "Target",
  approvals: "Approvals",
};

// Column order; the width arrays below are indexed by this list.
export const GRID_KEYS: SortKey[] = [
  "pullRequestId",
  "repositoryName",
  "title",
  "creationDate",
  "targetRefName",
  "approvals",
];
export const REQUIRED_COLUMNS: SortKey[] = ["pullRequestId", "title"];
export const DEFAULT_COLUMN_WIDTHS = [52, 130, 220, 90, 120, 76];
export const COLUMN_MIN_WIDTHS = [48, 96, 150, 72, 72, 60];
export const COLUMN_MAX_WIDTHS = [120, 520, 960, 160, 240, 160];
export const COLUMN_WIDTHS_STORAGE_KEY =
  "azdodeck:layout:myPullRequestsGridColumnWidths:v1";
export const VISIBLE_COLUMNS_STORAGE_KEY =
  "azdodeck:view:myPullRequestsGridColumns:v1";

export function defaultSortDirection(key: SortKey): SortDirection {
  return key === "creationDate" ? "desc" : "asc";
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export function comparePrs(
  a: MyCreatedPullRequestSummary,
  b: MyCreatedPullRequestSummary,
  key: SortKey,
): number {
  switch (key) {
    case "pullRequestId":
      return a.pullRequestId - b.pullRequestId;
    case "repositoryName":
      return compareStrings(a.repositoryName, b.repositoryName);
    case "title":
      return compareStrings(a.title, b.title);
    case "creationDate":
      return a.creationDate.localeCompare(b.creationDate);
    case "targetRefName":
      return compareStrings(a.targetRefName, b.targetRefName);
    case "approvals":
      return a.approvals - b.approvals;
  }
}
