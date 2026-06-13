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
import { Loader2, Plus } from "lucide-react";
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
  type DiffLine,
  type SideBySideCell,
} from "@/lib/diffView";
import { openExternalUrl } from "@/lib/openExternal";
import { isEditableTarget } from "@/lib/utils";
import { LoadingState, ErrorState, PreviewEmptyState } from "@/components/StateDisplay";
import { CommentComposer } from "./CommentComposer";
import { PrThreadCard } from "./PrThreadCard";

const MAX_RENDERED_DIFF_LINES = 2000;

type ViewMode = "unified" | "split";

const VIEW_MODE_STORAGE_KEY = "azdodeck:view:prDiffViewMode";

function loadViewMode(): ViewMode {
  return window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) === "unified"
    ? "unified"
    : "split";
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

const ADD_BADGE: ChangeBadge = { label: "A", cls: "border-green-200 bg-green-100 text-green-800" };
const DELETE_BADGE: ChangeBadge = { label: "D", cls: "border-red-200 bg-red-100 text-red-800" };
const RENAME_BADGE: ChangeBadge = {
  label: "R",
  cls: "border-purple-200 bg-purple-100 text-purple-800",
};
const EDIT_BADGE: ChangeBadge = { label: "M", cls: "border-blue-200 bg-blue-100 text-blue-800" };

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
  // Target-side line number where a new inline comment is being drafted.
  const [commentLine, setCommentLine] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewedKeys, setViewedKeys] = useState<Set<string>>(() =>
    loadViewedKeys(viewedStorageKey(pr)),
  );
  // Thread the n/p shortcuts last jumped to (for ordering).
  const [focusedThreadId, setFocusedThreadId] = useState<number | null>(null);
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

  // Reset selection state when switching PRs.
  useEffect(() => {
    setSelectedPath(null);
    setCommentLine(null);
    setActionError(null);
    setFocusedThreadId(null);
    setViewedKeys(loadViewedKeys(viewedStorageKey(pr)));
  }, [pr]);

  useEffect(() => {
    setCommentLine(null);
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
      setCommentLine(null);
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

  // Threads anchored to a right-side line of the selected file.
  const threadsByLine = useMemo(() => {
    const map = new Map<number, PrThread[]>();
    if (!selectedFile) return map;
    const selectedKey = pathKey(selectedFile.path);
    for (const thread of threads ?? []) {
      if (!thread.filePath || thread.rightLine == null) continue;
      if (pathKey(thread.filePath) !== selectedKey) continue;
      const list = map.get(thread.rightLine) ?? [];
      list.push(thread);
      map.set(thread.rightLine, list);
    }
    return map;
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

  const onStartComment = useCallback((line: number) => {
    setActionError(null);
    setCommentLine(line);
  }, []);

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
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const index = files.findIndex((file) => file.path === selectedPath);
      const delta = event.key === "j" ? 1 : -1;
      const nextIndex =
        index < 0
          ? event.key === "j"
            ? 0
            : files.length - 1
          : Math.max(0, Math.min(files.length - 1, index + delta));
      setSelectedPath(files[nextIndex].path);
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
    if (!selectedFile || commentLine == null) return Promise.resolve();
    return commentMutation
      .mutateAsync({
        ...prLocator(pr),
        content,
        filePath: selectedFile.path,
        rightLine: commentLine,
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

  // Inline block rendered under a right-side line: existing threads + comment box.
  function lineAttachments(rightLine: number | null) {
    if (rightLine == null) return null;
    const lineThreads = threadsByLine.get(rightLine) ?? [];
    const drafting = commentLine === rightLine;
    if (lineThreads.length === 0 && !drafting) return null;
    return (
      <div
        data-comment-line={rightLine}
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
            placeholder="Comment on this line… (Ctrl+Enter to post)"
            autoFocus
            busy={commentMutation.isPending}
            mentionSearch={mentionSearch}
            onSubmit={postInlineComment}
            onCancel={() => setCommentLine(null)}
            onSubmitted={() => setCommentLine(null)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col outline-none"
      data-primary-preview="true"
      tabIndex={-1}
      onKeyDown={handleFilesKeyDown}
    >
      {/* File list header with review progress */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-gray-50 px-2 py-1 text-[11px] text-muted-foreground">
        <span>
          {files.length} file{files.length === 1 ? "" : "s"} ·{" "}
          <span className={viewedCount === files.length ? "font-medium text-green-700" : ""}>
            {viewedCount}/{files.length} viewed
          </span>
        </span>
        <span className="text-muted-foreground/70">j/k files · n/p comments</span>
      </div>

      {/* File list */}
      <div ref={fileListRef} className="max-h-[40%] shrink-0 overflow-y-auto border-b border-border">
        {files.map((file) => {
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
              className={`flex w-full cursor-pointer items-center gap-1.5 px-2 py-1 text-left text-xs ${
                selected ? "bg-secondary" : "hover:bg-muted/50"
              } ${viewed ? "opacity-55" : ""}`}
              title={file.path}
            >
              <input
                type="checkbox"
                checked={viewed}
                onClick={(event) => event.stopPropagation()}
                onChange={() => toggleViewed(file.path)}
                aria-label={`Mark ${file.path} as viewed`}
                title="Mark viewed"
                className="h-3 w-3 shrink-0"
              />
              <span
                className={`inline-flex w-4 shrink-0 items-center justify-center rounded border text-[10px] font-semibold ${badge.cls}`}
                aria-label={file.changeType}
              >
                {badge.label}
              </span>
              {/* dir=rtl keeps the filename visible when truncating; the LRM
                  mark stops the leading slash from jumping to the end. */}
              <span
                className={`min-w-0 flex-1 truncate font-mono ${viewed ? "line-through" : ""}`}
                dir="rtl"
              >
                {`‎${file.path}`}
              </span>
              {threadCount > 0 ? (
                <span className="inline-flex shrink-0 items-center rounded-full border border-blue-200 bg-blue-50 px-1.5 text-[10px] font-medium text-blue-700">
                  {threadCount}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Diff toolbar */}
      {selectedFile ? (
        <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1">
          <span className="text-[11px] text-muted-foreground">
            Click a line number's + to comment
          </span>
          <div
            className="flex items-center gap-0.5 rounded border border-border bg-gray-50 p-0.5"
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
                    ? "bg-white text-foreground shadow-sm"
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
        <div className="m-2 shrink-0 rounded-md border border-destructive/30 bg-red-50 px-2 py-1 text-xs text-destructive">
          {actionError}
        </div>
      ) : null}

      {/* Diff */}
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
            baseContent={diffQuery.data.baseContent}
            targetContent={diffQuery.data.targetContent}
            baseUnavailableReason={diffQuery.data.baseUnavailableReason}
            targetUnavailableReason={diffQuery.data.targetUnavailableReason}
            webUrl={pr.webUrl}
            viewMode={viewMode}
            lineAttachments={lineAttachments}
            onStartComment={onStartComment}
          />
        ) : null}
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
  lineAttachments,
  onStartComment,
}: {
  baseContent: string | null;
  targetContent: string | null;
  baseUnavailableReason: string | null;
  targetUnavailableReason: string | null;
  webUrl: string | null;
  viewMode: ViewMode;
  lineAttachments: (rightLine: number | null) => ReactNode;
  onStartComment: (rightLine: number) => void;
}) {
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

  if (fatalReason) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-xs text-muted-foreground">
        <span>{UNAVAILABLE_MESSAGES[fatalReason] ?? "Diff is not available."}</span>
        {webUrl ? (
          <button
            type="button"
            onClick={() => openExternalUrl(webUrl)}
            className="rounded border border-border bg-white px-2 py-0.5 text-xs hover:bg-secondary"
          >
            Open in browser
          </button>
        ) : null}
      </div>
    );
  }

  const note = partialNote ? (
    <p className="border-b border-border bg-yellow-50 px-2 py-1 text-[11px] text-yellow-800">
      {partialNote}
    </p>
  ) : null;

  if (viewMode === "split") {
    const truncated = split.length > MAX_RENDERED_DIFF_LINES;
    const rendered = truncated ? split.slice(0, MAX_RENDERED_DIFF_LINES) : split;
    return (
      <div className="font-mono text-[11px] leading-4">
        {note}
        {rendered.map((row, index) => (
          <div key={index}>
            <div className="grid grid-cols-2">
              <SplitCell cell={row.left} side="left" onStartComment={onStartComment} />
              <SplitCell cell={row.right} side="right" onStartComment={onStartComment} />
            </div>
            {lineAttachments(row.right?.line ?? null)}
          </div>
        ))}
        {truncated ? <TruncationNote /> : null}
      </div>
    );
  }

  const truncated = unified.length > MAX_RENDERED_DIFF_LINES;
  const rendered = truncated ? unified.slice(0, MAX_RENDERED_DIFF_LINES) : unified;
  return (
    <div className="font-mono text-[11px] leading-4">
      {note}
      {rendered.map((line, index) => (
        <div key={index}>
          <DiffRow line={line} onStartComment={onStartComment} />
          {lineAttachments(line.targetLine)}
        </div>
      ))}
      {truncated ? <TruncationNote /> : null}
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
    ? "bg-green-50 text-green-900"
    : kind === "del"
      ? "bg-red-50 text-red-900"
      : "";
}

function CommentLineButton({ line, onStartComment }: { line: number; onStartComment: (line: number) => void }) {
  return (
    <button
      type="button"
      aria-label={`Comment on line ${line}`}
      onClick={() => onStartComment(line)}
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
  onStartComment: (rightLine: number) => void;
}) {
  const marker = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
  return (
    <div className={`group grid grid-cols-[3rem_3rem_1fr] ${rowBackground(line.kind)}`}>
      <span className="relative select-none border-r border-border/60 pr-1 text-right text-muted-foreground/70">
        {line.targetLine != null ? (
          <CommentLineButton line={line.targetLine} onStartComment={onStartComment} />
        ) : null}
        {line.baseLine ?? ""}
      </span>
      <span className="select-none border-r border-border/60 pr-1 text-right text-muted-foreground/70">
        {line.targetLine ?? ""}
      </span>
      <span className="whitespace-pre pl-1">
        {marker}
        {line.text}
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
  side: "left" | "right";
  onStartComment: (rightLine: number) => void;
}) {
  if (!cell) {
    return <div className="border-r border-border/60 bg-muted/20" aria-hidden="true" />;
  }
  return (
    <div className={`group grid min-w-0 grid-cols-[3rem_1fr] border-r border-border/60 ${rowBackground(cell.kind)}`}>
      <span className="relative select-none border-r border-border/60 pr-1 text-right text-muted-foreground/70">
        {side === "right" ? (
          <CommentLineButton line={cell.line} onStartComment={onStartComment} />
        ) : null}
        {cell.line}
      </span>
      {/* Long lines are clipped in split view; switch to unified to scroll. */}
      <span className="overflow-hidden whitespace-pre pl-1" title={cell.text}>
        {cell.text}
      </span>
    </div>
  );
});
