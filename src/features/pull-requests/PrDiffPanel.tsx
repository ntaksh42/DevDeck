import { type RefObject } from "react";
import type {
  MentionCandidate,
  PrChangedFile,
  PrThread,
  ReviewPullRequestSummary,
} from "@/lib/azdoCommands";
import { PreviewEmptyState } from "@/components/StateDisplay";
import { PrFileDiffSection } from "./PrFileDiffSection";
import {
  pathKey,
  VIEW_MODE_STORAGE_KEY,
  WHOLE_FILE_STORAGE_KEY,
  type CommentScrollRequest,
  type CommentSide,
  type DiffCommentDraft,
  type ViewMode,
} from "./PrFilesTabTypes";

export function PrDiffPanel({
  pr,
  hasFiles,
  sectionFiles,
  activeFile,
  viewMode,
  showWholeFile,
  actionError,
  baseCommitId,
  targetCommitId,
  diffScrollRef,
  onDiffScroll,
  isViewed,
  onToggleViewed,
  threadsByFile,
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
  registerSectionRef,
  setViewMode,
  setShowWholeFile,
}: {
  pr: ReviewPullRequestSummary;
  hasFiles: boolean;
  // Filtered files in tree order, independent of folder collapse state — the
  // continuous scroll shows every matching file regardless of what's
  // collapsed in the tree.
  sectionFiles: PrChangedFile[];
  activeFile: PrChangedFile | null;
  viewMode: ViewMode;
  showWholeFile: boolean;
  actionError: string | null;
  baseCommitId: string | null | undefined;
  targetCommitId: string | null | undefined;
  diffScrollRef: RefObject<HTMLDivElement | null>;
  onDiffScroll: () => void;
  isViewed: (path: string) => boolean;
  onToggleViewed: (path: string) => void;
  threadsByFile: Map<string, PrThread[]>;
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
  registerSectionRef: (path: string) => (el: HTMLDivElement | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setShowWholeFile: (updater: (prev: boolean) => boolean) => void;
}) {
  const renderedFiles = showWholeFile ? (activeFile ? [activeFile] : []) : sectionFiles;

  function sectionProps(file: PrChangedFile, eager: boolean) {
    return {
      pr,
      file,
      baseCommitId,
      targetCommitId,
      viewMode,
      wholeFile: showWholeFile,
      eager,
      viewed: isViewed(file.path),
      onToggleViewed: () => onToggleViewed(file.path),
      fileThreads: threadsByFile.get(pathKey(file.path)) ?? [],
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
      scrollRootRef: diffScrollRef,
      registerRef: registerSectionRef(file.path),
    };
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {hasFiles ? (
        <div className="flex shrink-0 items-center justify-end gap-2 border-b border-border bg-muted px-2 py-1">
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
            title="Show the whole file instead of only the changed regions (disables continuous scroll)"
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

      <div ref={diffScrollRef} onScroll={onDiffScroll} className="min-h-0 flex-1 overflow-auto">
        {!hasFiles ? (
          <PreviewEmptyState message="No changed files." />
        ) : renderedFiles.length === 0 ? (
          <PreviewEmptyState message="No files match your filter." />
        ) : (
          renderedFiles.map((file) => (
            <PrFileDiffSection key={file.path} {...sectionProps(file, showWholeFile)} />
          ))
        )}
      </div>
    </div>
  );
}
