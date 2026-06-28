import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import {
  commandErrorMessage,
  getAppSettings,
  getReviewResultPreview,
  type ReviewPullRequestSummary,
} from "@/lib/azdoCommands";
import { isEditableTarget } from "@/lib/utils";
import { openLocalPath } from "@/lib/openExternal";
import { LoadingState, PreviewEmptyState } from "@/components/StateDisplay";

// ── Result tab (local HTML review-result preview, moved from MyReviewsGrid) ──

export function ResultTab({ selectedPr }: { selectedPr: ReviewPullRequestSummary }) {
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });

  const previewQuery = useQuery({
    queryKey: ["reviewResultPreview", selectedPr.pullRequestId],
    queryFn: () => getReviewResultPreview({ pullRequestId: selectedPr.pullRequestId }),
  });

  const hasFolder = !!settingsQuery.data?.reviewResultFolderPath;
  const preview = previewQuery.data ?? null;
  const [openError, setOpenError] = useState<string | null>(null);

  const openInBrowser = useCallback(() => {
    if (!preview) return;
    setOpenError(null);
    openLocalPath(preview.filePath).catch((error) =>
      setOpenError(commandErrorMessage(error)),
    );
  }, [preview]);

  // `o` opens the HTML file in the default browser while the Result tab is
  // focused (skipped in text fields and with modifiers).
  function handleResultKeyDown(event: React.KeyboardEvent) {
    if (isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "o" && preview) {
      event.preventDefault();
      openInBrowser();
    }
  }

  if (settingsQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading
      </div>
    );
  }
  if (!hasFolder) {
    return <PreviewEmptyState message="Review result folder is not configured." />;
  }
  if (previewQuery.isError) {
    return (
      <div className="m-3 rounded-md border border-destructive/30 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-destructive">
        {commandErrorMessage(previewQuery.error)}
      </div>
    );
  }
  if (previewQuery.isLoading) {
    return <LoadingState />;
  }
  if (!preview) {
    return <PreviewEmptyState message={`No HTML file matched PR${selectedPr.pullRequestId}.`} />;
  }
  return (
    <div
      className="flex min-h-0 flex-1 flex-col outline-none"
      data-primary-preview="true"
      aria-keyshortcuts="Control+P"
      tabIndex={-1}
      onKeyDown={handleResultKeyDown}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium" title={preview.fileName}>
            {preview.fileName}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={preview.filePath}>
            {preview.filePath}
          </p>
        </div>
        <button
          type="button"
          onClick={openInBrowser}
          title="Open the review result in your browser (o)"
          className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs font-medium hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          Open in browser
          <span className="text-muted-foreground/70">o</span>
        </button>
      </div>
      {openError ? (
        <div className="m-3 rounded-md border border-destructive/30 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-destructive">
          {openError}
        </div>
      ) : null}
      {/* `allow-same-origin` (without `allow-scripts`, so the document still
          can't run JS) is required for the WebView2 desktop runtime to render
          a `srcDoc` document at all; with `sandbox=""` the frame stays blank in
          the desktop app. Mirrors the work item RichHtmlFrame. */}
      <iframe
        title={`Review result preview for PR${preview.pullRequestId}`}
        sandbox="allow-same-origin"
        srcDoc={preview.html}
        className="min-h-0 flex-1 bg-card outline-none"
      />
    </div>
  );
}
