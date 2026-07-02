import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  commandErrorMessage,
  listPullRequestChanges,
  prLocator,
  searchPullRequestMentions,
  type MentionCandidate,
  type PrThread,
  type ReviewPullRequestSummary,
} from "@/lib/azdoCommands";
import { focusPrimaryPreview, isEditableTarget } from "@/lib/utils";
import { fetchWorkItemImageCached } from "@/lib/workItemImageCache";
import { LoadingState, ErrorState, PreviewEmptyState } from "@/components/StateDisplay";
import { PrFileListPanel } from "./PrFileListPanel";
import { PrDiffPanel } from "./PrDiffPanel";
import { usePrFileComments } from "./usePrFileComments";
import {
  buildFileTreeRows,
  filterFilesByQuery,
  loadViewedKeys,
  loadViewMode,
  loadWholeFile,
  pathKey,
  viewedStorageKey,
  type CommentScrollRequest,
  type ViewMode,
} from "./PrFilesTabTypes";

// How long (ms) to ignore scroll-driven selection updates after a
// programmatic scroll (tree click, j/k, n/p, ]/[), so the resulting scroll
// doesn't immediately feed back into another selection change.
const SCROLL_TRACKING_SUPPRESS_MS = 300;

export function PrFilesTab({
  pr,
  threads,
}: {
  pr: ReviewPullRequestSummary;
  threads: PrThread[] | undefined;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  const [showWholeFile, setShowWholeFile] = useState<boolean>(loadWholeFile);
  const [viewedKeys, setViewedKeys] = useState<Set<string>>(() =>
    loadViewedKeys(viewedStorageKey(pr)),
  );
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const [filterQuery, setFilterQuery] = useState("");
  // Thread the n/p shortcuts last jumped to (for ordering).
  const [focusedThreadId, setFocusedThreadId] = useState<number | null>(null);
  const [scrollRequest, setScrollRequest] = useState<CommentScrollRequest | null>(null);

  const fileListRef = useRef<HTMLDivElement | null>(null);
  const diffScrollRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const suppressTrackingUntilRef = useRef(0);
  const scrollRafPendingRef = useRef(false);

  const comments = usePrFileComments(pr);

  const changesQuery = useQuery({
    queryKey: ["prChanges", pr.organizationId, pr.repositoryId, pr.pullRequestId],
    queryFn: () => listPullRequestChanges(prLocator(pr)),
    staleTime: 60_000,
  });

  const changes = changesQuery.data ?? null;
  const files = changes?.files ?? [];

  const filteredFiles = useMemo(() => filterFilesByQuery(files, filterQuery), [files, filterQuery]);

  // `rows` respects folder collapse (tree display); `visibleFiles` does not —
  // it lists every filtered file in tree order and drives j/k navigation and
  // the continuous diff scroll, so collapsing a folder only affects the tree.
  const { rows: fileTreeRows, visibleFiles: sectionFiles } = useMemo(
    () => buildFileTreeRows(filteredFiles, collapsedFolders),
    [filteredFiles, collapsedFolders],
  );

  // Falls back to the first section file so "Whole file" mode always has
  // something to show even before a file has been explicitly selected.
  const activeFile = useMemo(
    () => sectionFiles.find((file) => file.path === selectedPath) ?? sectionFiles[0] ?? null,
    [sectionFiles, selectedPath],
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
    setFilterQuery("");
    setFocusedThreadId(null);
    setScrollRequest(null);
    setCollapsedFolders(new Set());
    setViewedKeys(loadViewedKeys(viewedStorageKey(pr)));
    sectionRefs.current.clear();
  }, [pr]);

  // Default to the first file once the change list loads, so the continuous
  // scroll view opens with a section already active.
  useEffect(() => {
    if (selectedPath == null && sectionFiles.length > 0) {
      setSelectedPath(sectionFiles[0].path);
    }
  }, [selectedPath, sectionFiles]);

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

  // All threads grouped by file, handed to each diff section so it only
  // computes its own per-line thread index.
  const threadsByFile = useMemo(() => {
    const map = new Map<string, PrThread[]>();
    for (const thread of threads ?? []) {
      if (!thread.filePath) continue;
      const key = pathKey(thread.filePath);
      const list = map.get(key) ?? [];
      list.push(thread);
      map.set(key, list);
    }
    return map;
  }, [threads]);

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
  const isViewed = useCallback(
    (path: string) => viewedKeys.has(fileViewedKey(path)),
    [viewedKeys, fileViewedKey],
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

  const mentionSearch = useCallback(
    (query: string): Promise<MentionCandidate[]> =>
      searchPullRequestMentions({ organizationId: pr.organizationId, query }),
    [pr.organizationId],
  );
  const resolveImageSource = useCallback(
    (url: string) => fetchWorkItemImageCached({ organizationId: pr.organizationId, url }),
    [pr.organizationId],
  );

  function registerSectionRef(path: string) {
    return (el: HTMLDivElement | null) => {
      if (el) sectionRefs.current.set(path, el);
      else sectionRefs.current.delete(path);
    };
  }

  function scrollToSection(path: string, behavior: ScrollBehavior) {
    requestAnimationFrame(() => {
      const el = sectionRefs.current.get(path);
      if (!el) return;
      suppressTrackingUntilRef.current = Date.now() + SCROLL_TRACKING_SUPPRESS_MS;
      el.scrollIntoView({ block: "start", behavior });
    });
  }

  function selectFile(path: string) {
    setSelectedPath(path);
    scrollToSection(path, "auto");
  }

  // Tracks which section is nearest the top of the scroll container and syncs
  // it back to `selectedPath`, throttled to one check per frame. Suppressed
  // right after a programmatic scroll so the two mechanisms don't fight.
  function handleDiffScroll() {
    if (scrollRafPendingRef.current) return;
    scrollRafPendingRef.current = true;
    requestAnimationFrame(() => {
      scrollRafPendingRef.current = false;
      if (Date.now() < suppressTrackingUntilRef.current) return;
      const container = diffScrollRef.current;
      if (!container) return;
      const containerTop = container.getBoundingClientRect().top;
      let closestPath: string | null = null;
      let closestDist = Infinity;
      for (const [path, el] of sectionRefs.current) {
        const dist = Math.abs(el.getBoundingClientRect().top - containerTop);
        if (dist < closestDist) {
          closestDist = dist;
          closestPath = path;
        }
      }
      if (closestPath) {
        setSelectedPath((prev) => (prev === closestPath ? prev : closestPath));
      }
    });
  }

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

  function jumpHunk(direction: 1 | -1) {
    const container = diffScrollRef.current;
    if (!container) return;
    const marks = Array.from(container.querySelectorAll<HTMLElement>("[data-hunk-start]"));
    if (marks.length === 0) return;
    const containerTop = container.getBoundingClientRect().top;
    const target =
      direction === 1
        ? marks.find((el) => el.getBoundingClientRect().top > containerTop + 1)
        : [...marks].reverse().find((el) => el.getBoundingClientRect().top < containerTop - 1);
    if (!target) return;
    suppressTrackingUntilRef.current = Date.now() + SCROLL_TRACKING_SUPPRESS_MS;
    target.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function handleFilesKeyDown(event: React.KeyboardEvent) {
    if (isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "j" || event.key === "k") {
      if (sectionFiles.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const index = sectionFiles.findIndex((file) => file.path === selectedPath);
      const delta = event.key === "j" ? 1 : -1;
      const nextIndex =
        index < 0
          ? event.key === "j"
            ? 0
            : sectionFiles.length - 1
          : Math.max(0, Math.min(sectionFiles.length - 1, index + delta));
      selectFile(sectionFiles[nextIndex].path);
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
      scrollToSection(entry.filePath, "auto");
      setScrollRequest({ path: entry.filePath, line: entry.rightLine, nonce: Date.now() });
      return;
    }
    if (event.key === "]" || event.key === "[") {
      event.preventDefault();
      event.stopPropagation();
      jumpHunk(event.key === "]" ? 1 : -1);
    }
  }

  if (changesQuery.isLoading) return <LoadingState />;
  if (changesQuery.isError) return <ErrorState message={commandErrorMessage(changesQuery.error)} onRetry={() => void changesQuery.refetch()} />;
  if (files.length === 0) return <PreviewEmptyState message="No changed files." />;

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
        filterQuery={filterQuery}
        onFilterQueryChange={setFilterQuery}
        onSelectFile={selectFile}
        onToggleFolder={toggleFolder}
        onSetAllViewed={setAllViewed}
        fileListRef={fileListRef}
      />
      <PrDiffPanel
        pr={pr}
        hasFiles={files.length > 0}
        sectionFiles={sectionFiles}
        activeFile={activeFile}
        viewMode={viewMode}
        showWholeFile={showWholeFile}
        actionError={comments.actionError}
        baseCommitId={changes?.baseCommitId}
        targetCommitId={changes?.targetCommitId}
        diffScrollRef={diffScrollRef}
        onDiffScroll={handleDiffScroll}
        isViewed={isViewed}
        onToggleViewed={toggleViewed}
        threadsByFile={threadsByFile}
        mutationsBusy={comments.mutationsBusy}
        mentionSearch={mentionSearch}
        resolveImageSource={resolveImageSource}
        commentDraft={comments.commentDraft}
        commentBusy={comments.commentMutation.isPending}
        onStartComment={comments.startComment}
        onCancelComment={() => {
          comments.cancelComment();
          focusPrimaryPreview();
        }}
        onPostComment={comments.postInlineComment}
        onReplyThread={comments.replyToThread}
        onToggleThreadStatus={comments.toggleThreadStatus}
        onEditComment={comments.editComment}
        onDeleteComment={comments.deleteComment}
        scrollRequest={scrollRequest}
        registerSectionRef={registerSectionRef}
        setViewMode={setViewMode}
        setShowWholeFile={setShowWholeFile}
      />
    </div>
  );
}
