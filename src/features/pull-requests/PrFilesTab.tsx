import {
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown, Folder, Loader2, Plus } from "lucide-react";
import {
  commandErrorMessage,
  deletePullRequestComment,
  editPullRequestComment,
  getPullRequestFileDiff,
  listPullRequestChanges,
  postPullRequestComment,
  prLocator,
  searchPullRequestMentions,
  setPullRequestThreadStatus,
  type MentionCandidate,
  type PrChangedFile,
  type PrThread,
  type ReviewPullRequestSummary,
} from "@/lib/azdoCommands";
import {
  buildDiffLines,
  buildSideBySideRows,
  collapseDiff,
  type CollapsedItem,
  type DiffLine,
  type DiffLineKind,
  type InlineSegment,
  type SideBySideCell,
} from "@/lib/diffView";
import { openExternalUrl } from "@/lib/openExternal";
import { isEditableTarget } from "@/lib/utils";
import { LoadingState, ErrorState, PreviewEmptyState } from "@/components/StateDisplay";
import { CommentComposer } from "./CommentComposer";
import { PrThreadCard } from "./PrThreadCard";

const MAX_RENDERED_DIFF_LINES = 2000;
// Lines of unchanged context kept around each change before folding the rest.
const DIFF_CONTEXT_LINES = 3;
// Lines revealed per click of a gap's up/down expander.
const GAP_EXPAND_CHUNK = 20;

type GapReveal = { top: number; bottom: number };

type CommentSide = "left" | "right";
type DiffCommentDraft = { side: CommentSide; line: number };

type ViewMode = "unified" | "split";

const VIEW_MODE_STORAGE_KEY = "azdodeck:view:prDiffViewMode";

function loadViewMode(): ViewMode {
  return window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) === "unified"
    ? "unified"
    : "split";
}

const WHOLE_FILE_STORAGE_KEY = "azdodeck:view:prDiffWholeFile";

function loadWholeFile(): boolean {
  return window.localStorage.getItem(WHOLE_FILE_STORAGE_KEY) === "true";
}

function viewedStorageKey(pr: ReviewPullRequestSummary): string {
  return `azdodeck:prViewed:${pr.organizationId}:${pr.repositoryId}:${pr.pullRequestId}`;
}

function loadViewedKeys(key: string): Set<string> {
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
function changeTypeBadge(changeType: string): ChangeBadge {
  const tokens = changeType.toLowerCase().split(",").map((token) => token.trim());
  if (tokens.includes("rename")) return RENAME_BADGE;
  if (tokens.includes("delete")) return DELETE_BADGE;
  if (tokens.includes("add") || tokens.includes("undelete")) return ADD_BADGE;
  return EDIT_BADGE;
}

const UNAVAILABLE_MESSAGES: Record<string, string> = {
  binary: "Binary file — diff is not available.",
  tooLarge: "File is too large to diff in the app.",
  missing: "File content could not be loaded.",
};

/** Normalizes a server file path for matching across the threads and changes
 * APIs, which can differ in leading slash and casing. */
function pathKey(path: string): string {
  return path.replace(/^\/+/, "").toLowerCase();
}

type FileTreeRow =
  | { kind: "folder"; path: string; name: string; depth: number; collapsed: boolean }
  | { kind: "file"; file: PrChangedFile; name: string; depth: number };

type FileTreeNode = { folders: Map<string, FileTreeNode>; files: PrChangedFile[] };

/** Groups changed files into a collapsible folder tree (GitHub-style). Returns
 * the flattened render rows plus the files currently visible (under expanded
 * folders), which drives j/k navigation. */
function buildFileTreeRows(
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

export function PrFilesTab({
  pr,
  threads,
}: {
  pr: ReviewPullRequestSummary;
  threads: PrThread[] | undefined;
}) {
  const queryClient = useQueryClient();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  const [showWholeFile, setShowWholeFile] = useState<boolean>(loadWholeFile);
  // Side + line number where a new inline comment is being drafted. "right"
  // anchors to the target (new) file, "left" to the base (old) file.
  const [commentDraft, setCommentDraft] = useState<DiffCommentDraft | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewedKeys, setViewedKeys] = useState<Set<string>>(() =>
    loadViewedKeys(viewedStorageKey(pr)),
  );
  // Thread the n/p shortcuts last jumped to (for ordering).
  const [focusedThreadId, setFocusedThreadId] = useState<number | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const fileListRef = useRef<HTMLDivElement | null>(null);
  const diffScrollRef = useRef<HTMLDivElement | null>(null);

  const changesQuery = useQuery({
    queryKey: ["prChanges", pr.organizationId, pr.repositoryId, pr.pullRequestId],
    queryFn: () => listPullRequestChanges(prLocator(pr)),
    staleTime: 60_000,
  });

  const changes = changesQuery.data ?? null;
  const files = changes?.files ?? [];
  const selectedFile = files.find((file) => file.path === selectedPath) ?? null;

  const { rows: fileTreeRows, visibleFiles } = useMemo(
    () => buildFileTreeRows(files, collapsedFolders),
    [files, collapsedFolders],
  );

  function toggleFolder(path: string) {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  // Reset selection state when switching PRs.
  useEffect(() => {
    setSelectedPath(null);
    setCommentDraft(null);
    setActionError(null);
    setFocusedThreadId(null);
    setCollapsedFolders(new Set());
    setViewedKeys(loadViewedKeys(viewedStorageKey(pr)));
  }, [pr]);

  useEffect(() => {
    setCommentDraft(null);
  }, [selectedPath]);

  // Scope invalidation to this PR so other PRs' cached reviews stay warm.
  function invalidateReview() {
    void queryClient.invalidateQueries({
      queryKey: ["prReview", pr.organizationId, pr.repositoryId, pr.pullRequestId],
    });
  }

  const commentMutation = useMutation({
    mutationFn: postPullRequestComment,
    onSuccess: () => {
      setActionError(null);
      setCommentDraft(null);
      invalidateReview();
    },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const statusMutation = useMutation({
    mutationFn: setPullRequestThreadStatus,
    onSuccess: () => {
      setActionError(null);
      invalidateReview();
    },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const editMutation = useMutation({
    mutationFn: editPullRequestComment,
    onSuccess: () => {
      setActionError(null);
      invalidateReview();
    },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const deleteMutation = useMutation({
    mutationFn: deletePullRequestComment,
    onSuccess: () => {
      setActionError(null);
      invalidateReview();
    },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const mutationsBusy =
    commentMutation.isPending ||
    statusMutation.isPending ||
    editMutation.isPending ||
    deleteMutation.isPending;

  // Path matching is normalized: the threads and changes APIs can disagree on
  // leading slash and casing.
  const activeThreadCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const thread of threads ?? []) {
      if (!thread.filePath || thread.isResolved) continue;
      const key = pathKey(thread.filePath);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [threads]);

  // Threads of the selected file, indexed by the side + line they anchor to.
  // "right" is the target (new) file; "left" is the base (old) file.
  const { threadsByRightLine, threadsByLeftLine } = useMemo(() => {
    const right = new Map<number, PrThread[]>();
    const left = new Map<number, PrThread[]>();
    if (!selectedFile) return { threadsByRightLine: right, threadsByLeftLine: left };
    const selectedKey = pathKey(selectedFile.path);
    for (const thread of threads ?? []) {
      if (!thread.filePath || pathKey(thread.filePath) !== selectedKey) continue;
      if (thread.rightLine != null) {
        const list = right.get(thread.rightLine) ?? [];
        list.push(thread);
        right.set(thread.rightLine, list);
      } else if (thread.leftLine != null) {
        const list = left.get(thread.leftLine) ?? [];
        list.push(thread);
        left.set(thread.leftLine, list);
      }
    }
    return { threadsByRightLine: right, threadsByLeftLine: left };
  }, [threads, selectedFile]);

  // Viewed state is keyed by file path + target commit, so a new iteration
  // re-surfaces files for review (GitHub resets "viewed" when content changes).
  const targetCommit = changes?.targetCommitId ?? "";
  const fileViewedKey = useCallback(
    (path: string) => `${pathKey(path)}@${targetCommit}`,
    [targetCommit],
  );
  const viewedCount = files.reduce(
    (count, file) => count + (viewedKeys.has(fileViewedKey(file.path)) ? 1 : 0),
    0,
  );

  // Unresolved file-anchored threads in file/line order, for n/p navigation.
  const orderedUnresolvedThreads = useMemo(() => {
    const result: { threadId: number; filePath: string; rightLine: number }[] = [];
    for (const file of files) {
      const key = pathKey(file.path);
      const fileThreads = (threads ?? [])
        .filter(
          (thread) =>
            thread.filePath &&
            thread.rightLine != null &&
            !thread.isResolved &&
            pathKey(thread.filePath) === key,
        )
        .sort((a, b) => (a.rightLine ?? 0) - (b.rightLine ?? 0));
      for (const thread of fileThreads) {
        result.push({ threadId: thread.id, filePath: file.path, rightLine: thread.rightLine as number });
      }
    }
    return result;
  }, [files, threads]);

  const diffQuery = useQuery({
    // Commit ids are part of the key so a new iteration does not serve a stale
    // cached diff.
    queryKey: [
      "prFileDiff",
      pr.organizationId,
      pr.repositoryId,
      pr.pullRequestId,
      selectedFile?.path,
      changes?.baseCommitId,
      changes?.targetCommitId,
    ],
    queryFn: () =>
      getPullRequestFileDiff({
        ...prLocator(pr),
        filePath: (selectedFile as PrChangedFile).path,
        originalPath: selectedFile?.originalPath ?? null,
        changeType: selectedFile?.changeType ?? "edit",
        baseCommitId: changes?.baseCommitId ?? null,
        targetCommitId: changes?.targetCommitId ?? null,
      }),
    enabled: !!selectedFile && !!changes,
    staleTime: 60_000,
  });

  const onStartComment = useCallback((side: CommentSide, line: number) => {
    setActionError(null);
    setCommentDraft({ side, line });
  }, []);

  // A line carrying a comment thread or an open draft must never be folded away.
  const lineHasContent = useCallback(
    (side: CommentSide, line: number | null): boolean => {
      if (line == null) return false;
      const source = side === "right" ? threadsByRightLine : threadsByLeftLine;
      if ((source.get(line)?.length ?? 0) > 0) return true;
      return commentDraft?.side === side && commentDraft.line === line;
    },
    [threadsByRightLine, threadsByLeftLine, commentDraft],
  );

  const mentionSearch = useCallback(
    (query: string): Promise<MentionCandidate[]> =>
      searchPullRequestMentions({ organizationId: pr.organizationId, query }),
    [pr.organizationId],
  );

  // Scroll the n/p-focused thread into view once its file's diff is rendered.
  useEffect(() => {
    if (focusedThreadId == null) return;
    const entry = orderedUnresolvedThreads.find((thread) => thread.threadId === focusedThreadId);
    if (!entry || entry.filePath !== selectedPath) return;
    const target = diffScrollRef.current?.querySelector(
      `[data-comment-line="${entry.rightLine}"]`,
    );
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusedThreadId, selectedPath, orderedUnresolvedThreads, diffQuery.data]);

  function toggleViewed(path: string) {
    setViewedKeys((prev) => {
      const next = new Set(prev);
      const key = fileViewedKey(path);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      window.localStorage.setItem(viewedStorageKey(pr), JSON.stringify([...next]));
      return next;
    });
  }

  function handleFilesKeyDown(event: React.KeyboardEvent) {
    if (isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "j" || event.key === "k") {
      if (visibleFiles.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const index = visibleFiles.findIndex((file) => file.path === selectedPath);
      const delta = event.key === "j" ? 1 : -1;
      const nextIndex =
        index < 0
          ? event.key === "j"
            ? 0
            : visibleFiles.length - 1
          : Math.max(0, Math.min(visibleFiles.length - 1, index + delta));
      setSelectedPath(visibleFiles[nextIndex].path);
      return;
    }
    if (event.key === "n" || event.key === "p") {
      if (orderedUnresolvedThreads.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const current = orderedUnresolvedThreads.findIndex((t) => t.threadId === focusedThreadId);
      const delta = event.key === "n" ? 1 : -1;
      const nextIndex =
        current < 0
          ? event.key === "n"
            ? 0
            : orderedUnresolvedThreads.length - 1
          : (current + delta + orderedUnresolvedThreads.length) % orderedUnresolvedThreads.length;
      const entry = orderedUnresolvedThreads[nextIndex];
      setSelectedPath(entry.filePath);
      setFocusedThreadId(entry.threadId);
    }
  }

  if (changesQuery.isLoading) return <LoadingState />;
  if (changesQuery.isError) return <ErrorState message={commandErrorMessage(changesQuery.error)} />;
  if (files.length === 0) return <PreviewEmptyState message="No changed files." />;

  function postInlineComment(content: string): Promise<void> {
    if (!selectedFile || !commentDraft) return Promise.resolve();
    return commentMutation
      .mutateAsync({
        ...prLocator(pr),
        content,
        filePath: selectedFile.path,
        ...(commentDraft.side === "left"
          ? { leftLine: commentDraft.line }
          : { rightLine: commentDraft.line }),
      })
      .then(() => undefined);
  }

  function replyToThread(thread: PrThread, content: string): Promise<void> {
    return commentMutation
      .mutateAsync({ ...prLocator(pr), threadId: thread.id, content })
      .then(() => undefined);
  }

  function toggleThreadStatus(thread: PrThread) {
    statusMutation.mutate({
      ...prLocator(pr),
      threadId: thread.id,
      status: thread.isResolved ? "active" : "closed",
    });
  }

  function editComment(thread: PrThread, commentId: number, content: string): Promise<void> {
    return editMutation
      .mutateAsync({ ...prLocator(pr), threadId: thread.id, commentId, content })
      .then(() => undefined);
  }

  function deleteComment(thread: PrThread, commentId: number): Promise<void> {
    return deleteMutation.mutateAsync({ ...prLocator(pr), threadId: thread.id, commentId });
  }

  // Inline block rendered under a diff line: existing threads + comment box for
  // the given side ("right" = target file, "left" = base file).
  function lineAttachments(side: CommentSide, line: number | null) {
    if (line == null) return null;
    const source = side === "right" ? threadsByRightLine : threadsByLeftLine;
    const lineThreads = source.get(line) ?? [];
    const drafting = commentDraft?.side === side && commentDraft.line === line;
    if (lineThreads.length === 0 && !drafting) return null;
    return (
      <div
        // n/p navigation scrolls to right-side threads via this attribute.
        data-comment-line={side === "right" ? line : undefined}
        className="space-y-1 border-y border-border bg-muted/30 px-2 py-1.5 font-sans whitespace-normal"
      >
        {lineThreads.map((thread) => (
          <PrThreadCard
            key={thread.id}
            thread={thread}
            busy={mutationsBusy}
            showFilePath={false}
            mentionSearch={mentionSearch}
            onReply={(content) => replyToThread(thread, content)}
            onToggleStatus={() => toggleThreadStatus(thread)}
            onEditComment={(commentId, content) => editComment(thread, commentId, content)}
            onDeleteComment={(commentId) => deleteComment(thread, commentId)}
          />
        ))}
        {drafting ? (
          <CommentComposer
            placeholder={
              side === "left"
                ? "Comment on the old line… (Ctrl+Enter to post)"
                : "Comment on this line… (Ctrl+Enter to post)"
            }
            autoFocus
            busy={commentMutation.isPending}
            mentionSearch={mentionSearch}
            onSubmit={postInlineComment}
            onCancel={() => setCommentDraft(null)}
            onSubmitted={() => setCommentDraft(null)}
          />
        ) : null}
      </div>
    );
  }

  const selectedViewed = selectedFile
    ? viewedKeys.has(fileViewedKey(selectedFile.path))
    : false;

  return (
    <div
      className="flex min-h-0 flex-1 outline-none"
      data-primary-preview="true"
      tabIndex={-1}
      onKeyDown={handleFilesKeyDown}
    >
      {/* Left: file list (GitHub-style file sidebar) */}
      <div className="flex w-2/5 min-w-[150px] max-w-[340px] shrink-0 flex-col border-r border-border">
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted px-2 py-1 text-[11px] text-muted-foreground">
          <span>
            {files.length} file{files.length === 1 ? "" : "s"} ·{" "}
            <span className={viewedCount === files.length ? "font-medium text-green-700 dark:text-green-400" : ""}>
              {viewedCount}/{files.length} viewed
            </span>
          </span>
          <span className="text-muted-foreground/70" title="j/k move files · n/p jump comments">
            j/k · n/p
          </span>
        </div>
        <div ref={fileListRef} className="min-h-0 flex-1 overflow-y-auto">
          {fileTreeRows.map((row) => {
            if (row.kind === "folder") {
              return (
                <button
                  key={`folder:${row.path}`}
                  type="button"
                  onClick={() => toggleFolder(row.path)}
                  aria-expanded={!row.collapsed}
                  className="flex w-full items-center gap-1 py-1 pr-2 text-left text-xs text-muted-foreground hover:bg-muted/50"
                  style={{ paddingLeft: 8 + row.depth * 12 }}
                  title={row.path}
                >
                  {row.collapsed ? (
                    <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
                  )}
                  <Folder className="h-3 w-3 shrink-0 text-muted-foreground/70" aria-hidden="true" />
                  <span className="truncate font-mono">{row.name}</span>
                </button>
              );
            }
            const file = row.file;
            const badge = changeTypeBadge(file.changeType);
            const threadCount = activeThreadCounts.get(pathKey(file.path)) ?? 0;
            const selected = file.path === selectedPath;
            const viewed = viewedKeys.has(fileViewedKey(file.path));
            return (
              <div
                key={file.path}
                role="button"
                tabIndex={-1}
                onClick={() => setSelectedPath(file.path)}
                className={`flex w-full cursor-pointer items-center gap-1.5 py-1 pr-2 text-left text-xs ${
                  selected ? "bg-secondary" : "hover:bg-muted/50"
                } ${viewed ? "opacity-55" : ""}`}
                style={{ paddingLeft: 8 + row.depth * 12 + 4 }}
                title={file.path}
              >
                <span
                  className={`inline-flex w-4 shrink-0 items-center justify-center rounded border text-[10px] font-semibold ${badge.cls}`}
                  aria-label={file.changeType}
                >
                  {badge.label}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate font-mono ${viewed ? "line-through" : ""}`}
                >
                  {row.name}
                </span>
                {threadCount > 0 ? (
                  <span className="inline-flex shrink-0 items-center rounded-full border border-blue-200 bg-blue-50 px-1.5 text-[10px] font-medium text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
                    {threadCount}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: selected file diff */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {selectedFile ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted px-2 py-1">
            <span
              className="min-w-0 flex-1 truncate font-mono text-[11px]"
              dir="rtl"
              title={selectedFile.path}
            >
              {`‎${selectedFile.path}`}
            </span>
            <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={selectedViewed}
                onChange={() => toggleViewed(selectedFile.path)}
                className="h-3 w-3"
              />
              Viewed
            </label>
            <button
              type="button"
              aria-pressed={showWholeFile}
              onClick={() => {
                setShowWholeFile((value) => {
                  const next = !value;
                  window.localStorage.setItem(WHOLE_FILE_STORAGE_KEY, String(next));
                  return next;
                });
              }}
              title="Show the whole file instead of only the changed regions"
              className={`shrink-0 rounded border px-2 py-px text-[11px] font-medium ${
                showWholeFile
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-secondary"
              }`}
            >
              Whole file
            </button>
            <div
              className="flex shrink-0 items-center gap-0.5 rounded border border-border bg-card p-0.5"
              role="tablist"
              aria-label="Diff view mode"
            >
              {(["unified", "split"] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={viewMode === mode}
                  onClick={() => {
                    setViewMode(mode);
                    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
                  }}
                  className={`rounded px-2 py-px text-[11px] font-medium ${
                    viewMode === mode
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {mode === "unified" ? "Unified" : "Split"}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {actionError ? (
          <div className="m-2 shrink-0 rounded-md border border-destructive/30 bg-red-50 dark:bg-red-950/40 px-2 py-1 text-xs text-destructive">
            {actionError}
          </div>
        ) : null}

        <div ref={diffScrollRef} className="min-h-0 flex-1 overflow-auto">
          {!selectedFile ? (
            <PreviewEmptyState message="Select a file to view its diff." />
          ) : diffQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading diff
            </div>
          ) : diffQuery.isError ? (
            <ErrorState message={commandErrorMessage(diffQuery.error)} />
          ) : diffQuery.data ? (
            <DiffContent
              // Remount per file/iteration so collapsed/expanded state resets.
              key={`${selectedFile.path}@${changes?.targetCommitId ?? ""}`}
              baseContent={diffQuery.data.baseContent}
              targetContent={diffQuery.data.targetContent}
              baseUnavailableReason={diffQuery.data.baseUnavailableReason}
              targetUnavailableReason={diffQuery.data.targetUnavailableReason}
              webUrl={pr.webUrl}
              viewMode={viewMode}
              wholeFile={showWholeFile}
              lineAttachments={lineAttachments}
              lineHasContent={lineHasContent}
              onStartComment={onStartComment}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DiffContent({
  baseContent,
  targetContent,
  baseUnavailableReason,
  targetUnavailableReason,
  webUrl,
  viewMode,
  wholeFile,
  lineAttachments,
  lineHasContent,
  onStartComment,
}: {
  baseContent: string | null;
  targetContent: string | null;
  baseUnavailableReason: string | null;
  targetUnavailableReason: string | null;
  webUrl: string | null;
  viewMode: ViewMode;
  wholeFile: boolean;
  lineAttachments: (side: CommentSide, line: number | null) => ReactNode;
  lineHasContent: (side: CommentSide, line: number | null) => boolean;
  onStartComment: (side: CommentSide, line: number) => void;
}) {
  // Gaps the reader expanded, keyed by their first hidden line's numbers.
  const [gapReveal, setGapReveal] = useState<Map<string, GapReveal>>(() => new Map());

  const baseBlocked = baseUnavailableReason != null;
  const targetBlocked = targetUnavailableReason != null;
  // Only give up when neither side can be shown. A single blocked side still
  // renders (e.g. base too large → show the new file as additions).
  const fatalReason =
    baseBlocked && targetBlocked ? (targetUnavailableReason ?? baseUnavailableReason) : null;
  // A blocked side is treated as empty so the available side still diffs.
  const baseText = baseBlocked ? "" : baseContent ?? "";
  const targetText = targetBlocked ? "" : targetContent ?? "";
  const partialNote = fatalReason
    ? null
    : targetBlocked
      ? `New version unavailable (${UNAVAILABLE_MESSAGES[targetUnavailableReason!] ?? targetUnavailableReason}); showing the previous version.`
      : baseBlocked
        ? `Previous version unavailable (${UNAVAILABLE_MESSAGES[baseUnavailableReason!] ?? baseUnavailableReason}); showing the new file.`
        : null;

  const unified = useMemo(
    () => (fatalReason || viewMode !== "unified" ? [] : buildDiffLines(baseText, targetText)),
    [baseText, targetText, fatalReason, viewMode],
  );
  const split = useMemo(
    () => (fatalReason || viewMode !== "split" ? [] : buildSideBySideRows(baseText, targetText)),
    [baseText, targetText, fatalReason, viewMode],
  );

  // Fold unchanged runs, but never a line that carries a comment or open draft.
  // "Whole file" disables folding so every line of the file stays visible.
  const collapsedUnified = useMemo(
    () =>
      collapseDiff(
        unified,
        wholeFile
          ? () => false
          : (line) =>
              line.kind === "context" &&
              !lineHasContent("right", line.targetLine) &&
              !lineHasContent("left", line.baseLine),
        DIFF_CONTEXT_LINES,
      ),
    [unified, lineHasContent, wholeFile],
  );
  const collapsedSplit = useMemo(
    () =>
      collapseDiff(
        split,
        wholeFile
          ? () => false
          : (row) =>
              row.left?.kind === "context" &&
              row.right?.kind === "context" &&
              !lineHasContent("left", row.left.line) &&
              !lineHasContent("right", row.right.line),
        DIFF_CONTEXT_LINES,
      ),
    [split, lineHasContent, wholeFile],
  );

  if (fatalReason) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-xs text-muted-foreground">
        <span>{UNAVAILABLE_MESSAGES[fatalReason] ?? "Diff is not available."}</span>
        {webUrl ? (
          <button
            type="button"
            onClick={() => openExternalUrl(webUrl)}
            className="rounded border border-border bg-card px-2 py-0.5 text-xs hover:bg-secondary"
          >
            Open in browser
          </button>
        ) : null}
      </div>
    );
  }

  function revealGap(key: string, side: "top" | "bottom" | "all", total: number) {
    setGapReveal((prev) => {
      const next = new Map(prev);
      const current = next.get(key) ?? { top: 0, bottom: 0 };
      if (side === "all") {
        next.set(key, { top: total, bottom: 0 });
      } else {
        const room = total - current.top - current.bottom;
        const step = Math.min(GAP_EXPAND_CHUNK, room);
        next.set(
          key,
          side === "top"
            ? { ...current, top: current.top + step }
            : { ...current, bottom: current.bottom + step },
        );
      }
      return next;
    });
  }

  const note = partialNote ? (
    <p className="border-b border-border bg-yellow-50 px-2 py-1 text-[11px] text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300">
      {partialNote}
    </p>
  ) : null;

  if (viewMode === "split") {
    return (
      <div className="font-mono text-[11px] leading-4">
        {note}
        <CollapsedDiff
          items={collapsedSplit}
          gapReveal={gapReveal}
          onRevealGap={revealGap}
          gapKey={(row) => `${row.left?.line ?? ""}:${row.right?.line ?? ""}`}
          renderRow={(row, key) => (
            <div key={key}>
              <div className="grid grid-cols-2">
                <SplitCell cell={row.left} side="left" onStartComment={onStartComment} />
                <SplitCell cell={row.right} side="right" onStartComment={onStartComment} />
              </div>
              {lineAttachments("left", row.left ? row.left.line : null)}
              {lineAttachments("right", row.right ? row.right.line : null)}
            </div>
          )}
        />
      </div>
    );
  }

  return (
    <div className="font-mono text-[11px] leading-4">
      {note}
      <CollapsedDiff
        items={collapsedUnified}
        gapReveal={gapReveal}
        onRevealGap={revealGap}
        gapKey={(line) => `${line.baseLine ?? ""}:${line.targetLine ?? ""}`}
        renderRow={(line, key) => {
          // Deleted lines anchor to the old (left) file; everything else to new.
          const side: CommentSide = line.kind === "del" ? "left" : "right";
          const anchorLine = line.kind === "del" ? line.baseLine : line.targetLine;
          return (
            <div key={key}>
              <DiffRow line={line} onStartComment={onStartComment} />
              {lineAttachments(side, anchorLine)}
            </div>
          );
        }}
      />
    </div>
  );
}

/**
 * Renders a collapsed diff: visible rows plus "expand" bars for folded gaps.
 * The overall visible-row count is capped so a single huge change run cannot
 * lock up rendering.
 */
function CollapsedDiff<T>({
  items,
  gapReveal,
  onRevealGap,
  gapKey,
  renderRow,
}: {
  items: CollapsedItem<T>[];
  gapReveal: Map<string, GapReveal>;
  onRevealGap: (key: string, side: "top" | "bottom" | "all", total: number) => void;
  gapKey: (row: T) => string;
  renderRow: (row: T, key: string) => ReactNode;
}) {
  const out: ReactNode[] = [];
  let rendered = 0;
  let truncated = false;

  function pushRows(rows: T[], from: number, to: number, prefix: string) {
    for (let k = from; k < to; k++) {
      if (rendered >= MAX_RENDERED_DIFF_LINES) {
        truncated = true;
        return;
      }
      out.push(renderRow(rows[k], `${prefix}${k}`));
      rendered += 1;
    }
  }

  for (let i = 0; i < items.length && !truncated; i++) {
    const item = items[i];
    if (item.type === "row") {
      pushRows([item.row], 0, 1, `r${i}-`);
      continue;
    }
    const key = gapKey(item.rows[0]);
    const total = item.rows.length;
    const reveal = gapReveal.get(key) ?? { top: 0, bottom: 0 };
    const middle = total - reveal.top - reveal.bottom;
    // Rows already revealed from the top of the gap.
    pushRows(item.rows, 0, reveal.top, `g${i}-`);
    if (truncated) break;
    if (middle > 0) {
      out.push(
        <GapBar
          key={`gap${i}`}
          count={middle}
          onExpandUp={() => onRevealGap(key, "top", total)}
          onExpandDown={() => onRevealGap(key, "bottom", total)}
          onExpandAll={() => onRevealGap(key, "all", total)}
        />,
      );
    }
    // Rows already revealed from the bottom of the gap.
    pushRows(item.rows, total - reveal.bottom, total, `g${i}-`);
  }

  return (
    <>
      {out}
      {truncated ? <TruncationNote /> : null}
    </>
  );
}

function GapBar({
  count,
  onExpandUp,
  onExpandDown,
  onExpandAll,
}: {
  count: number;
  onExpandUp: () => void;
  onExpandDown: () => void;
  onExpandAll: () => void;
}) {
  const cls =
    "flex items-center justify-center hover:bg-muted/70 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-ring";
  return (
    <div className="flex w-full items-stretch border-y border-border/60 bg-muted/40 text-[11px] text-muted-foreground">
      <button
        type="button"
        onClick={onExpandUp}
        title={`Expand ${GAP_EXPAND_CHUNK} lines up`}
        aria-label="Expand up"
        className={`${cls} w-7`}
      >
        <ChevronUp className="h-3 w-3" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onExpandAll}
        className={`${cls} flex-1 gap-1 border-x border-border/60 py-0.5`}
      >
        <ChevronsUpDown className="h-3 w-3" aria-hidden="true" />
        Expand {count} unchanged line{count === 1 ? "" : "s"}
      </button>
      <button
        type="button"
        onClick={onExpandDown}
        title={`Expand ${GAP_EXPAND_CHUNK} lines down`}
        aria-label="Expand down"
        className={`${cls} w-7`}
      >
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}

function TruncationNote() {
  return (
    <p className="px-2 py-1 text-[11px] italic text-muted-foreground">
      Diff truncated to the first {MAX_RENDERED_DIFF_LINES} lines.
    </p>
  );
}

function rowBackground(kind: SideBySideCell["kind"] | DiffLine["kind"]): string {
  return kind === "add"
    ? "bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-200"
    : kind === "del"
      ? "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200"
      : "";
}

/** Renders line text, highlighting the changed words of a partial edit. */
function LineText({
  segments,
  text,
  kind,
}: {
  segments?: InlineSegment[];
  text: string;
  kind: DiffLineKind;
}) {
  if (!segments) return <>{text}</>;
  const highlight = kind === "add" ? "rounded-sm bg-green-200/80 dark:bg-green-700/50" : "rounded-sm bg-red-200/80 dark:bg-red-700/50";
  return (
    <>
      {segments.map((segment, index) =>
        segment.highlight ? (
          <span key={index} className={highlight}>
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function CommentLineButton({
  side,
  line,
  onStartComment,
}: {
  side: CommentSide;
  line: number;
  onStartComment: (side: CommentSide, line: number) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Comment on ${side === "left" ? "old " : ""}line ${line}`}
      onClick={() => onStartComment(side, line)}
      className="invisible absolute inset-y-0 left-0 flex w-4 items-center justify-center rounded-sm bg-primary text-primary-foreground group-hover:visible"
    >
      <Plus className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}

// Memoized so toolbar/comment-box state changes don't re-render every diff row.
const DiffRow = memo(function DiffRow({
  line,
  onStartComment,
}: {
  line: DiffLine;
  onStartComment: (side: CommentSide, line: number) => void;
}) {
  const marker = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
  return (
    <div className={`group grid grid-cols-[3rem_3rem_1fr] ${rowBackground(line.kind)}`}>
      <span className="relative select-none border-r border-border/60 pr-1 text-right text-muted-foreground/70">
        {line.kind === "del" && line.baseLine != null ? (
          <CommentLineButton side="left" line={line.baseLine} onStartComment={onStartComment} />
        ) : null}
        {line.baseLine ?? ""}
      </span>
      <span className="relative select-none border-r border-border/60 pr-1 text-right text-muted-foreground/70">
        {line.kind !== "del" && line.targetLine != null ? (
          <CommentLineButton side="right" line={line.targetLine} onStartComment={onStartComment} />
        ) : null}
        {line.targetLine ?? ""}
      </span>
      <span className="whitespace-pre pl-1">
        {marker}
        <LineText segments={line.segments} text={line.text} kind={line.kind} />
      </span>
    </div>
  );
});

const SplitCell = memo(function SplitCell({
  cell,
  side,
  onStartComment,
}: {
  cell: SideBySideCell | null;
  side: CommentSide;
  onStartComment: (side: CommentSide, line: number) => void;
}) {
  if (!cell) {
    return <div className="border-r border-border/60 bg-muted/20" aria-hidden="true" />;
  }
  return (
    <div className={`group grid min-w-0 grid-cols-[3rem_1fr] border-r border-border/60 ${rowBackground(cell.kind)}`}>
      <span className="relative select-none border-r border-border/60 pr-1 text-right text-muted-foreground/70">
        <CommentLineButton side={side} line={cell.line} onStartComment={onStartComment} />
        {cell.line}
      </span>
      {/* Wrap long lines so split view no longer needs a switch to unified. */}
      <span className="whitespace-pre-wrap break-all pl-1">
        <LineText segments={cell.segments} text={cell.text} kind={cell.kind} />
      </span>
    </div>
  );
});
