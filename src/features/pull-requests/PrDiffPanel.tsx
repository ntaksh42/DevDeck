import { type ReactNode, type RefObject } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { commandErrorMessage, type PrChangedFile, type ReviewPullRequestSummary } from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { ErrorState, PreviewEmptyState } from "@/components/StateDisplay";
import { DiffContent } from "./PrFileDiffView";
import {
  prFileDiffUrl,
  VIEW_MODE_STORAGE_KEY,
  WHOLE_FILE_STORAGE_KEY,
  type CommentSide,
  type ViewMode,
} from "./PrFilesTabTypes";

type DiffData = {
  baseContent: string | null;
  targetContent: string | null;
  baseUnavailableReason: string | null;
  targetUnavailableReason: string | null;
};

export function PrDiffPanel({
  pr,
  selectedFile,
  selectedViewed,
  viewMode,
  showWholeFile,
  actionError,
  targetCommitId,
  diffScrollRef,
  diffIsLoading,
  diffIsError,
  diffError,
  diffData,
  onRetryDiff,
  lineAttachments,
  lineHasContent,
  onStartComment,
  onToggleViewed,
  setViewMode,
  setShowWholeFile,
}: {
  pr: ReviewPullRequestSummary;
  selectedFile: PrChangedFile | null;
  selectedViewed: boolean;
  viewMode: ViewMode;
  showWholeFile: boolean;
  actionError: string | null;
  targetCommitId: string | null | undefined;
  diffScrollRef: RefObject<HTMLDivElement | null>;
  diffIsLoading: boolean;
  diffIsError: boolean;
  diffError: unknown;
  diffData: DiffData | undefined;
  onRetryDiff: () => void;
  lineAttachments: (side: CommentSide, line: number | null) => ReactNode;
  lineHasContent: (side: CommentSide, line: number | null) => boolean;
  onStartComment: (side: CommentSide, line: number) => void;
  onToggleViewed: () => void;
  setViewMode: (mode: ViewMode) => void;
  setShowWholeFile: (updater: (prev: boolean) => boolean) => void;
}) {
  return (
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
              onChange={onToggleViewed}
              className="h-3 w-3"
            />
            Viewed
          </label>
          {pr.webUrl ? (
            <button
              type="button"
              onClick={() => openExternalUrl(prFileDiffUrl(pr.webUrl as string, selectedFile.path))}
              title={`Open diff in Azure DevOps: ${selectedFile.path}`}
              aria-label={`Open diff for ${selectedFile.path} in Azure DevOps`}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
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
        ) : diffIsLoading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading diff
          </div>
        ) : diffIsError ? (
          <ErrorState message={commandErrorMessage(diffError)} onRetry={onRetryDiff} />
        ) : diffData ? (
          <DiffContent
            // Remount per file/iteration so collapsed/expanded state resets.
            key={`${selectedFile.path}@${targetCommitId ?? ""}`}
            baseContent={diffData.baseContent}
            targetContent={diffData.targetContent}
            baseUnavailableReason={diffData.baseUnavailableReason}
            targetUnavailableReason={diffData.targetUnavailableReason}
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
  );
}
