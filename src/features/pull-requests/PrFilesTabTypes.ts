import type { PrChangedFile, ReviewPullRequestSummary } from "@/lib/azdoCommands";

export const MAX_RENDERED_DIFF_LINES = 2000;
// Lines of unchanged context kept around each change before folding the rest.
export const DIFF_CONTEXT_LINES = 3;
// Lines revealed per click of a gap's up/down expander.
export const GAP_EXPAND_CHUNK = 20;

export type GapReveal = { top: number; bottom: number };

export type CommentSide = "left" | "right";
export type DiffCommentDraft = { side: CommentSide; line: number };

export type ViewMode = "unified" | "split";

export const VIEW_MODE_STORAGE_KEY = "azdodeck:view:prDiffViewMode";

export function loadViewMode(): ViewMode {
  return window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) === "unified"
    ? "unified"
    : "split";
}

export const WHOLE_FILE_STORAGE_KEY = "azdodeck:view:prDiffWholeFile";

export function loadWholeFile(): boolean {
  return window.localStorage.getItem(WHOLE_FILE_STORAGE_KEY) === "true";
}

export function viewedStorageKey(pr: ReviewPullRequestSummary): string {
  return `azdodeck:prViewed:${pr.organizationId}:${pr.repositoryId}:${pr.pullRequestId}`;
}

// Deep-links to the file's diff in the Azure DevOps PR web UI. The PR web URL
// already targets the right org/project/repo/PR; `?path=…&_a=files` selects the
// file in the Files tab, mirroring the commit view's per-file external link.
export function prFileDiffUrl(prWebUrl: string, path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${prWebUrl}?path=${encodeURIComponent(normalized)}&_a=files`;
}

export function loadViewedKeys(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [],
    );
  } catch {
    return new Set();
  }
}

type ChangeBadge = { label: string; cls: string };

const ADD_BADGE: ChangeBadge = { label: "A", cls: "border-green-200 bg-green-100 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300" };
const DELETE_BADGE: ChangeBadge = { label: "D", cls: "border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300" };
const RENAME_BADGE: ChangeBadge = {
  label: "R",
  cls: "border-purple-200 bg-purple-100 text-purple-800 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-300",
};
const EDIT_BADGE: ChangeBadge = { label: "M", cls: "border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300" };

/** Token-aware badge: "undelete" is a restore, not a delete. */
export function changeTypeBadge(changeType: string): ChangeBadge {
  const tokens = changeType.toLowerCase().split(",").map((token) => token.trim());
  if (tokens.includes("rename")) return RENAME_BADGE;
  if (tokens.includes("delete")) return DELETE_BADGE;
  if (tokens.includes("add") || tokens.includes("undelete")) return ADD_BADGE;
  return EDIT_BADGE;
}

export const UNAVAILABLE_MESSAGES: Record<string, string> = {
  binary: "Binary file — diff is not available.",
  tooLarge: "File is too large to diff in the app.",
  missing: "File content could not be loaded.",
};

/** Normalizes a server file path for matching across the threads and changes
 * APIs, which can differ in leading slash and casing. */
export function pathKey(path: string): string {
  return path.replace(/^\/+/, "").toLowerCase();
}

export type FileTreeRow =
  | { kind: "folder"; path: string; name: string; depth: number; collapsed: boolean }
  | { kind: "file"; file: PrChangedFile; name: string; depth: number };

type FileTreeNode = { folders: Map<string, FileTreeNode>; files: PrChangedFile[] };

/** Groups changed files into a collapsible folder tree (GitHub-style). Returns
 * the flattened render rows plus the files currently visible (under expanded
 * folders), which drives j/k navigation. */
export function buildFileTreeRows(
  files: PrChangedFile[],
  collapsed: Set<string>,
): { rows: FileTreeRow[]; visibleFiles: PrChangedFile[] } {
  const root: FileTreeNode = { folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.replace(/^\/+/, "").split("/");
    parts.pop(); // file name handled at render time
    let node = root;
    for (const part of parts) {
      let child = node.folders.get(part);
      if (!child) {
        child = { folders: new Map(), files: [] };
        node.folders.set(part, child);
      }
      node = child;
    }
    node.files.push(file);
  }

  const rows: FileTreeRow[] = [];
  const visibleFiles: PrChangedFile[] = [];
  const walk = (node: FileTreeNode, prefix: string, depth: number) => {
    for (const name of [...node.folders.keys()].sort((a, b) => a.localeCompare(b))) {
      const path = prefix ? `${prefix}/${name}` : name;
      const isCollapsed = collapsed.has(path);
      rows.push({ kind: "folder", path, name, depth, collapsed: isCollapsed });
      if (!isCollapsed) walk(node.folders.get(name)!, path, depth + 1);
    }
    for (const file of [...node.files].sort((a, b) => a.path.localeCompare(b.path))) {
      const name = file.path.replace(/^\/+/, "").split("/").pop() ?? file.path;
      rows.push({ kind: "file", file, name, depth });
      visibleFiles.push(file);
    }
  };
  walk(root, "", 0);
  return { rows, visibleFiles };
}
