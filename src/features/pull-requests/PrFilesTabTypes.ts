import type { PrChangedFile, ReviewPullRequestSummary } from "@/lib/azdoCommands";

export const MAX_RENDERED_DIFF_LINES = 2000;
// Lines of unchanged context kept around each change before folding the rest.
export const DIFF_CONTEXT_LINES = 3;
// Lines revealed per click of a gap's up/down expander.
export const GAP_EXPAND_CHUNK = 20;

export type GapReveal = { top: number; bottom: number };

export type CommentSide = "left" | "right";
// `path` scopes the draft to a single file's diff section now that every
// changed file's diff renders at once (continuous scroll).
export type DiffCommentDraft = { path: string; side: CommentSide; line: number };

// Height (px) of a diff section's sticky header, kept in sync with the layout
// so `scroll-margin-top` keeps the section's first line from hiding under it.
export const SECTION_HEADER_HEIGHT = 33;

/** A pending scroll to a specific comment line inside a specific file's
 * section, used by n/p navigation. `nonce` forces the effect to re-run even
 * when the same file/line is requested twice in a row. */
export type CommentScrollRequest = { path: string; line: number; nonce: number };

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

export type ChangeMarker = { symbol: string; cls: string; label: string };

const ADD_MARKER: ChangeMarker = { symbol: "+", cls: "text-green-600 dark:text-green-400", label: "add" };
const DELETE_MARKER: ChangeMarker = { symbol: "−", cls: "text-red-600 dark:text-red-400", label: "delete" };
const RENAME_MARKER: ChangeMarker = { symbol: "→", cls: "text-purple-600 dark:text-purple-400", label: "rename" };

/** Azure DevOps-style change marker: add/undelete = green "+", delete = red
 * "−", rename = purple "→", edit = no marker at all. Token-aware ("undelete"
 * is a restore, not a delete) like the badge this replaces. */
export function changeTypeMarker(changeType: string): ChangeMarker | null {
  const tokens = changeType.toLowerCase().split(",").map((token) => token.trim());
  if (tokens.includes("rename")) return RENAME_MARKER;
  if (tokens.includes("delete")) return DELETE_MARKER;
  if (tokens.includes("add") || tokens.includes("undelete")) return ADD_MARKER;
  return null;
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

function buildFileTree(files: PrChangedFile[]): FileTreeNode {
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
  return root;
}

/** Groups changed files into a collapsible folder tree (Azure DevOps-style).
 * Returns the flattened render rows (respecting `collapsed`, with single-child
 * folder chains compressed into one row, e.g. "src/features/pull-requests")
 * plus every file in the same depth-first tree order regardless of collapse
 * state. The latter drives j/k navigation and the continuous diff scroll, so
 * collapsing a folder only affects the tree's own display. */
export function buildFileTreeRows(
  files: PrChangedFile[],
  collapsed: Set<string>,
): { rows: FileTreeRow[]; visibleFiles: PrChangedFile[] } {
  const root = buildFileTree(files);

  const rows: FileTreeRow[] = [];
  const walkRows = (node: FileTreeNode, prefix: string, depth: number) => {
    for (const name of [...node.folders.keys()].sort((a, b) => a.localeCompare(b))) {
      // Compress a chain of folders that hold no files of their own and have
      // exactly one subfolder into a single row, mirroring Azure DevOps' Files
      // tab (e.g. "src/features/pull-requests" as one line). The collapse key
      // is the full merged path.
      let mergedName = name;
      let mergedPath = prefix ? `${prefix}/${name}` : name;
      let child = node.folders.get(name)!;
      while (child.folders.size === 1 && child.files.length === 0) {
        const [nextName] = child.folders.keys();
        mergedName = `${mergedName}/${nextName}`;
        mergedPath = `${mergedPath}/${nextName}`;
        child = child.folders.get(nextName)!;
      }
      const isCollapsed = collapsed.has(mergedPath);
      rows.push({ kind: "folder", path: mergedPath, name: mergedName, depth, collapsed: isCollapsed });
      if (!isCollapsed) walkRows(child, mergedPath, depth + 1);
    }
    for (const file of [...node.files].sort((a, b) => a.path.localeCompare(b.path))) {
      const name = file.path.replace(/^\/+/, "").split("/").pop() ?? file.path;
      rows.push({ kind: "file", file, name, depth });
    }
  };
  walkRows(root, "", 0);

  const visibleFiles: PrChangedFile[] = [];
  const walkAll = (node: FileTreeNode) => {
    for (const name of [...node.folders.keys()].sort((a, b) => a.localeCompare(b))) {
      walkAll(node.folders.get(name)!);
    }
    for (const file of [...node.files].sort((a, b) => a.path.localeCompare(b.path))) {
      visibleFiles.push(file);
    }
  };
  walkAll(root);

  return { rows, visibleFiles };
}

/** Case-insensitive substring match against the full path, used by the file
 * list filter box. Not persisted (each PR view starts unfiltered). */
export function filterFilesByQuery(files: PrChangedFile[], query: string): PrChangedFile[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return files;
  return files.filter((file) => file.path.toLowerCase().includes(trimmed));
}
