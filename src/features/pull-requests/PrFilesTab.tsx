import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { focusPrimaryPreview, isEditableTarget } from "@/lib/utils";
import { fetchWorkItemImageCached } from "@/lib/workItemImageCache";
import { LoadingState, ErrorState, PreviewEmptyState } from "@/components/StateDisplay";
import { CommentComposer } from "./CommentComposer";
import { PrThreadCard } from "./PrThreadCard";
import { PrFileListPanel } from "./PrFileListPanel";
import { PrDiffPanel } from "./PrDiffPanel";
import {
  buildFileTreeRows,
  loadViewedKeys,
  loadViewMode,
  loadWholeFile,
  pathKey,
  viewedStorageKey,
  type CommentSide,
  type DiffCommentDraft,
  type ViewMode,
} from "./PrFilesTabTypes";

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
  const resolveImageSource = useCallback(
    (url: string) => fetchWorkItemImageCached({ organizationId: pr.organizationId, url }),
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

  // Bulk-mark every changed file viewed (or clear them all) in one action.
  function setAllViewed(viewed: boolean) {
    setViewedKeys((prev) => {
      const next = new Set(prev);
      for (const file of files) {
        const key = fileViewedKey(file.path);
        if (viewed) next.add(key);
        else next.delete(key);
      }
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
    if (event.key === "v") {
      if (!selectedPath) return;
      event.preventDefault();
      event.stopPropagation();
      toggleViewed(selectedPath);
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
  if (changesQuery.isError) return <ErrorState message={commandErrorMessage(changesQuery.error)} onRetry={() => void changesQuery.refetch()} />;
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
  function lineAttachments(side: CommentSide, line: number | null): ReactNode {
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
            resolveImageSource={resolveImageSource}
            baseUrl={pr.webUrl}
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
            onCancel={() => {
              setCommentDraft(null);
              focusPrimaryPreview();
            }}
            onSubmitted={() => {
              setCommentDraft(null);
              focusPrimaryPreview();
            }}
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
      <PrFileListPanel
        files={files}
        fileTreeRows={fileTreeRows}
        selectedPath={selectedPath}
        viewedKeys={viewedKeys}
        fileViewedKey={fileViewedKey}
        viewedCount={viewedCount}
        activeThreadCounts={activeThreadCounts}
        onSelectFile={setSelectedPath}
        onToggleFolder={toggleFolder}
        onSetAllViewed={setAllViewed}
        fileListRef={fileListRef}
      />
      <PrDiffPanel
        pr={pr}
        selectedFile={selectedFile}
        selectedViewed={selectedViewed}
        viewMode={viewMode}
        showWholeFile={showWholeFile}
        actionError={actionError}
        targetCommitId={changes?.targetCommitId}
        diffScrollRef={diffScrollRef}
        diffIsLoading={diffQuery.isLoading}
        diffIsError={diffQuery.isError}
        diffError={diffQuery.error}
        diffData={diffQuery.data}
        onRetryDiff={() => void diffQuery.refetch()}
        lineAttachments={lineAttachments}
        lineHasContent={lineHasContent}
        onStartComment={onStartComment}
        onToggleViewed={() => { if (selectedFile) toggleViewed(selectedFile.path); }}
        setViewMode={setViewMode}
        setShowWholeFile={setShowWholeFile}
      />
    </div>
  );
}
