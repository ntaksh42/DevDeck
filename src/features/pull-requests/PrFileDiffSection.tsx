import { type ReactNode, type RefObject, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2 } from "lucide-react";
import {
  commandErrorMessage,
  getPullRequestFileDiff,
  prLocator,
  type MentionCandidate,
  type PrChangedFile,
  type PrThread,
  type ReviewPullRequestSummary,
} from "@/lib/azdoCommands";
import { eolOnlyChange, summarizeDiff } from "@/lib/diffView";
import { openExternalUrl } from "@/lib/openExternal";
import { ErrorState } from "@/components/StateDisplay";
import { CommentComposer } from "./CommentComposer";
import { PrThreadCard } from "./PrThreadCard";
import { DiffContent } from "./PrFileDiffView";
import {
  prFileDiffUrl,
  SECTION_HEADER_HEIGHT,
  type CommentScrollRequest,
  type CommentSide,
  type DiffCommentDraft,
  type ViewMode,
} from "./PrFilesTabTypes";

// How close to the scroll container's viewport a section must get before its
// diff query is enabled. Generous so scrolling feels instant, not so large
// that every section loads at once.
const LAZY_LOAD_ROOT_MARGIN = "800px 0px";

// Memoized so that a state change unrelated to this file (opening a comment box
// on another file, toggling another file's viewed checkbox, scrolling) does not
// rebuild this file's diff, which can be up to MAX_RENDERED_DIFF_LINES rows.
// This only helps because every prop below is referentially stable across
// unrelated renders: `onToggleViewed`/`onStartComment`/`registerRef` take
// `file.path` as an argument here (bound via useCallback) instead of being
// pre-bound per file by the caller, which used to make them new closures on
// every render of the whole file list.
export const PrFileDiffSection = memo(function PrFileDiffSection({
  pr,
  file,
  baseCommitId,
  targetCommitId,
  viewMode,
  wholeFile,
  eager,
  viewed,
  onToggleViewed,
  fileThreads,
  mutationsBusy,
  mentionSearch,
  resolveImageSource,
  commentDraft,
  commentBusy,
  onStartComment,
  onCancelComment,
  onPostComment,
  onReplyThread,
  onToggleThreadStatus,
  onEditComment,
  onDeleteComment,
  scrollRequest,
  scrollRootRef,
  registerRef,
}: {
  pr: ReviewPullRequestSummary;
  file: PrChangedFile;
  baseCommitId: string | null | undefined;
  targetCommitId: string | null | undefined;
  viewMode: ViewMode;
  wholeFile: boolean;
  // Whole-file mode renders a single section for the selected file only; it
  // should load immediately instead of waiting on IntersectionObserver.
  eager: boolean;
  viewed: boolean;
  onToggleViewed: (path: string) => void;
  fileThreads: PrThread[];
  mutationsBusy: boolean;
  mentionSearch: (query: string) => Promise<MentionCandidate[]>;
  resolveImageSource: (url: string) => Promise<string | null>;
  commentDraft: DiffCommentDraft | null;
  commentBusy: boolean;
  onStartComment: (path: string, side: CommentSide, line: number) => void;
  onCancelComment: () => void;
  onPostComment: (content: string) => Promise<void>;
  onReplyThread: (thread: PrThread, content: string) => Promise<void>;
  onToggleThreadStatus: (thread: PrThread) => void;
  onEditComment: (thread: PrThread, commentId: number, content: string) => Promise<void>;
  onDeleteComment: (thread: PrThread, commentId: number) => Promise<void>;
  scrollRequest: CommentScrollRequest | null;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  registerRef: (path: string, el: HTMLDivElement | null) => void;
}) {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [enabled, setEnabled] = useState(eager);
  const path = file.path;

  const handleToggleViewed = useCallback(() => onToggleViewed(path), [onToggleViewed, path]);
  const handleRegisterRef = useCallback(
    (el: HTMLDivElement | null) => registerRef(path, el),
    [registerRef, path],
  );
  const handleStartComment = useCallback(
    (side: CommentSide, line: number) => onStartComment(path, side, line),
    [onStartComment, path],
  );

  // Defer the diff fetch until the section scrolls near the viewport.
  useEffect(() => {
    if (eager || enabled) return;
    if (typeof IntersectionObserver === "undefined") {
      setEnabled(true);
      return;
    }
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setEnabled(true);
          observer.disconnect();
        }
      },
      { root: scrollRootRef.current, rootMargin: LAZY_LOAD_ROOT_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [eager, enabled, scrollRootRef]);

  const diffQuery = useQuery({
    // Same key shape as the previous single-file query so cached diffs (and
    // in-flight requests) survive the switch to per-section fetching.
    queryKey: [
      "prFileDiff",
      pr.organizationId,
      pr.repositoryId,
      pr.pullRequestId,
      file.path,
      baseCommitId,
      targetCommitId,
    ],
    queryFn: () =>
      getPullRequestFileDiff({
        ...prLocator(pr),
        filePath: file.path,
        originalPath: file.originalPath ?? null,
        changeType: file.changeType,
        baseCommitId: baseCommitId ?? null,
        targetCommitId: targetCommitId ?? null,
      }),
    enabled,
    staleTime: 60_000,
  });

  const diffData = diffQuery.data;
  const baseBlocked = diffData?.baseUnavailableReason != null;
  const targetBlocked = diffData?.targetUnavailableReason != null;
  const fatalReason = baseBlocked && targetBlocked;
  const baseText = baseBlocked ? "" : diffData?.baseContent ?? "";
  const targetText = targetBlocked ? "" : diffData?.targetContent ?? "";
  const summary = useMemo(
    () => (diffData && !fatalReason ? summarizeDiff(baseText, targetText) : null),
    [diffData, fatalReason, baseText, targetText],
  );

  const eolChange = useMemo(
    () => (diffData && !fatalReason ? eolOnlyChange(baseText, targetText) : null),
    [diffData, fatalReason, baseText, targetText],
  );

  // Threads for this file, indexed by the side + line they anchor to.
  const { threadsByRightLine, threadsByLeftLine } = useMemo(() => {
    const right = new Map<number, PrThread[]>();
    const left = new Map<number, PrThread[]>();
    for (const thread of fileThreads) {
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
  }, [fileThreads]);

  const draftHere = commentDraft?.path === file.path ? commentDraft : null;

  const lineHasContent = useCallback(
    (side: CommentSide, line: number | null): boolean => {
      if (line == null) return false;
      const source = side === "right" ? threadsByRightLine : threadsByLeftLine;
      if ((source.get(line)?.length ?? 0) > 0) return true;
      return draftHere?.side === side && draftHere.line === line;
    },
    [threadsByRightLine, threadsByLeftLine, draftHere],
  );

  const lineAttachments = useCallback(
    (side: CommentSide, line: number | null): ReactNode => {
      if (line == null) return null;
      const source = side === "right" ? threadsByRightLine : threadsByLeftLine;
      const lineThreads = source.get(line) ?? [];
      const drafting = draftHere?.side === side && draftHere.line === line;
      if (lineThreads.length === 0 && !drafting) return null;
      return (
        <div
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
              onReply={(content) => onReplyThread(thread, content)}
              onToggleStatus={() => onToggleThreadStatus(thread)}
              onEditComment={(commentId, content) => onEditComment(thread, commentId, content)}
              onDeleteComment={(commentId) => onDeleteComment(thread, commentId)}
            />
          ))}
          {drafting ? (
            <CommentComposer
              placeholder={
                side === "left"
                  ? "Comment on the old line…"
                  : "Comment on this line…"
              }
              autoFocus
              busy={commentBusy}
              mentionSearch={mentionSearch}
              onSubmit={onPostComment}
              onCancel={onCancelComment}
              onSubmitted={onCancelComment}
            />
          ) : null}
        </div>
      );
    },
    [
      threadsByRightLine,
      threadsByLeftLine,
      draftHere,
      mutationsBusy,
      mentionSearch,
      resolveImageSource,
      pr.webUrl,
      onReplyThread,
      onToggleThreadStatus,
      onEditComment,
      onDeleteComment,
      commentBusy,
      onPostComment,
      onCancelComment,
    ],
  );

  // Fine-scroll to a specific comment line once this file's diff is loaded.
  useEffect(() => {
    if (!scrollRequest || scrollRequest.path !== file.path || !diffData) return;
    const target = bodyRef.current?.querySelector(`[data-comment-line="${scrollRequest.line}"]`);
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [scrollRequest, diffData, file.path]);

  return (
    <div
      ref={(el) => {
        sectionRef.current = el;
        handleRegisterRef(el);
      }}
      data-file-section={file.path}
      style={{ scrollMarginTop: SECTION_HEADER_HEIGHT }}
    >
      <div
        className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-muted px-2 py-1"
        style={{ minHeight: SECTION_HEADER_HEIGHT }}
      >
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]" dir="rtl" title={file.path}>
          {`‎${file.path}`}
        </span>
        {summary ? (
          <span className="shrink-0 font-mono text-[11px]">
            <span className="text-green-700 dark:text-green-400">+{summary.additions}</span>{" "}
            <span className="text-red-700 dark:text-red-400">−{summary.deletions}</span>
            {eolChange ? (
              <span
                title={`Only line endings changed (${eolChange})`}
                className="ml-1 rounded bg-blue-100 px-1 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
              >
                EOL
              </span>
            ) : null}
          </span>
        ) : null}
        <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={viewed} onChange={handleToggleViewed} className="h-3 w-3" />
          Viewed
        </label>
        {pr.webUrl ? (
          <button
            type="button"
            onClick={() => openExternalUrl(prFileDiffUrl(pr.webUrl as string, file.path))}
            title={`Open diff in Azure DevOps: ${file.path}`}
            aria-label={`Open diff for ${file.path} in Azure DevOps`}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div ref={bodyRef}>
        {!enabled ? (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            <span className="truncate font-mono" dir="rtl" title={file.path}>
              {`‎${file.path}`}
            </span>
          </div>
        ) : diffQuery.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading diff
          </div>
        ) : diffQuery.isError ? (
          <ErrorState
            message={commandErrorMessage(diffQuery.error)}
            onRetry={() => void diffQuery.refetch()}
          />
        ) : diffData ? (
          <DiffContent
            // Remount per iteration so collapsed/expanded gap state resets.
            key={`${file.path}@${targetCommitId ?? ""}`}
            baseContent={diffData.baseContent}
            targetContent={diffData.targetContent}
            baseUnavailableReason={diffData.baseUnavailableReason}
            targetUnavailableReason={diffData.targetUnavailableReason}
            webUrl={pr.webUrl}
            viewMode={viewMode}
            wholeFile={wholeFile}
            lineAttachments={lineAttachments}
            lineHasContent={lineHasContent}
            onStartComment={handleStartComment}
          />
        ) : null}
      </div>
    </div>
  );
});
PrFileDiffSection.displayName = "PrFileDiffSection";
