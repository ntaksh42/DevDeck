import { useQuery } from "@tanstack/react-query";
import type { ReviewPullRequestSummary } from "@/lib/azdoCommands";
import { appSettingsQuery, reviewResultQuery } from "@/components/agent-notes/resultQueries";
import { AgentResultPanel } from "@/components/agent-notes/AgentResultPanel";

// ── Result tab (local HTML review-result preview, moved from MyReviewsGrid) ──
// Hosts agent notes for the reviewing agent alongside the result, like the
// work item Result panel.

export function ResultTab({
  selectedPr,
  commentModeRequest = 0,
}: {
  selectedPr: Pick<ReviewPullRequestSummary, "pullRequestId">;
  commentModeRequest?: number;
}) {
  const settingsQuery = useQuery(appSettingsQuery);
  const previewQuery = useQuery(reviewResultQuery(selectedPr.pullRequestId));

  const hasFolder = !!settingsQuery.data?.reviewResultFolderPath;

  return (
    <AgentResultPanel
      item={{ target: "pull-request", itemId: selectedPr.pullRequestId }}
      hasFolder={hasFolder}
      loading={settingsQuery.isLoading || previewQuery.isLoading}
      error={previewQuery.isError ? previewQuery.error : null}
      preview={previewQuery.data ?? null}
      frameTitle={`Review result preview for PR${selectedPr.pullRequestId}`}
      noFolderMessage="Review result folder is not configured."
      noMatchMessage={`No HTML file matched PR${selectedPr.pullRequestId}.`}
      commentModeRequest={commentModeRequest}
      primaryPreview
    />
  );
}
