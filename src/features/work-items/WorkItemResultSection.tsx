import { useQuery } from "@tanstack/react-query";
import { getAppSettings, getWorkItemResultPreview } from "@/lib/azdoCommands";
import { AgentResultPanel } from "@/components/agent-notes/AgentResultPanel";

// Mirrors the PR "Result" tab (PrSecondaryTabs.tsx), matching a locally
// generated HTML report by work item id instead of PR id. Rendered as its own
// dockable panel (see WorkItemsGrid.tsx) rather than a section embedded in
// the main preview, so it fills the height it's given instead of a fixed
// scroll box. Alongside the result it hosts agent notes (AgentResultPanel).
export function WorkItemResultSection({
  workItemId,
  commentModeRequest = 0,
}: {
  workItemId: number;
  commentModeRequest?: number;
}) {
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });

  const hasFolder = !!settingsQuery.data?.workItemResultFolderPath;

  const previewQuery = useQuery({
    queryKey: ["workItemResultPreview", workItemId],
    queryFn: () => getWorkItemResultPreview({ workItemId }),
    enabled: hasFolder,
  });

  return (
    <AgentResultPanel
      item={{ target: "work-item", itemId: workItemId }}
      hasFolder={hasFolder}
      loading={settingsQuery.isLoading || previewQuery.isLoading}
      error={previewQuery.isError ? previewQuery.error : null}
      preview={previewQuery.data ?? null}
      frameTitle={`Review result preview for work item ${workItemId}`}
      noFolderMessage="Set a work item result folder in Settings to see investigation output here."
      noMatchMessage={`No HTML file matched work item ${workItemId}.`}
      commentModeRequest={commentModeRequest}
    />
  );
}
