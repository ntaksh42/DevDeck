import { type CommitSummary, type CommitRepositoryOption } from "@/lib/azdoCommands";
import {
  type CommitColumnKey,
  type CommitSearchViewState,
  type CommitSortKey,
  type CommitSortState,
  type CommitViewMode,
  COMMIT_COLUMN_KEYS,
  COMMIT_GRID_KEYS,
  COMMIT_REQUIRED_COLUMNS,
  COMMIT_SEARCH_VIEW_STORAGE_KEY,
  COMMIT_SORT_STORAGE_KEY,
  COMMIT_VIEW_MODE_STORAGE_KEY,
  COMMIT_VISIBLE_COLUMNS_STORAGE_KEY,
} from "./commitSearchConstants";

export function prStatusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case "completed":
      return "border-green-200 bg-green-100 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300";
    case "abandoned":
      return "border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300";
    default:
      return "border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300";
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function loadCommitVisibleColumns(): CommitColumnKey[] {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(COMMIT_VISIBLE_COLUMNS_STORAGE_KEY) ?? "null",
    );
    if (!Array.isArray(parsed)) return [...COMMIT_COLUMN_KEYS];
    const set = new Set(
      parsed.filter((v): v is CommitColumnKey =>
        COMMIT_COLUMN_KEYS.includes(v as CommitColumnKey),
      ),
    );
    for (const required of COMMIT_REQUIRED_COLUMNS) set.add(required);
    const ordered = COMMIT_COLUMN_KEYS.filter((key) => set.has(key));
    return ordered.length > 0 ? ordered : [...COMMIT_COLUMN_KEYS];
  } catch {
    return [...COMMIT_COLUMN_KEYS];
  }
}

export function loadCommitSearchViewState(): CommitSearchViewState {
  const fallback: CommitSearchViewState = {
    author: "",
    branch: "",
    fromDate: "",
    organizationId: "",
    projectIds: [],
    query: "",
    repositoryIds: [],
    toDate: "",
  };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMMIT_SEARCH_VIEW_STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    return {
      author: typeof parsed.author === "string" ? parsed.author : "",
      branch: typeof parsed.branch === "string" ? parsed.branch : "",
      fromDate: typeof parsed.fromDate === "string" ? parsed.fromDate : "",
      organizationId: typeof parsed.organizationId === "string" ? parsed.organizationId : "",
      projectIds: stringArray(parsed.projectIds),
      query: typeof parsed.query === "string" ? parsed.query : "",
      repositoryIds: stringArray(parsed.repositoryIds),
      toDate: typeof parsed.toDate === "string" ? parsed.toDate : "",
    };
  } catch {
    return fallback;
  }
}

export function storeCommitSearchViewState(state: CommitSearchViewState) {
  window.localStorage.setItem(COMMIT_SEARCH_VIEW_STORAGE_KEY, JSON.stringify(state));
}

export function loadCommitViewMode(): CommitViewMode {
  return window.localStorage.getItem(COMMIT_VIEW_MODE_STORAGE_KEY) === "activity"
    ? "activity"
    : "results";
}

export function commitPrQueryKey(commit: CommitSummary) {
  return ["commitPullRequests", commit.organizationId, commit.repositoryId, commit.commitId] as const;
}

export function uniqueCommitProjects(repositories: CommitRepositoryOption[]) {
  const projects = new Map<string, { projectId: string; projectName: string }>();
  for (const repository of repositories) {
    projects.set(repository.projectId, {
      projectId: repository.projectId,
      projectName: repository.projectName,
    });
  }
  return [...projects.values()].sort((a, b) => a.projectName.localeCompare(b.projectName));
}

export function defaultCommitSortDir(key: CommitSortKey): "asc" | "desc" {
  return key === "date" ? "desc" : "asc";
}

export function compareCommitsByKey(a: CommitSummary, b: CommitSummary, key: CommitSortKey): number {
  switch (key) {
    case "date":
      return (a.authorDate ?? "").localeCompare(b.authorDate ?? "");
    case "repository":
      return `${a.projectName}/${a.repositoryName}`.localeCompare(`${b.projectName}/${b.repositoryName}`);
    case "author":
      return (a.authorName ?? "").localeCompare(b.authorName ?? "");
    case "comment":
      return a.comment.localeCompare(b.comment);
  }
}

export function loadCommitSort(): CommitSortState {
  const fallback: CommitSortState = { key: "date", direction: "desc" };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMMIT_SORT_STORAGE_KEY) ?? "null");
    if (
      !parsed ||
      !COMMIT_GRID_KEYS.includes(parsed.key) ||
      (parsed.direction !== "asc" && parsed.direction !== "desc")
    ) {
      return fallback;
    }
    return { key: parsed.key, direction: parsed.direction };
  } catch {
    return fallback;
  }
}
