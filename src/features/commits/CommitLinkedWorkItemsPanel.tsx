import { useQueries, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  type CommitSummary,
  getWorkItemPreview,
  listCommitWorkItems,
} from "@/lib/azdoCommands";
import { extractWorkItemMentions, navigateToWorkItem } from "@/lib/crossLinks";
import { PreviewBand } from "@/components/PreviewBand";
import { workItemQueryKeys } from "@/features/work-items/queryKeys";
import { workItemStateDotClass } from "@/features/work-items/WorkItemPreviewDetails";

// The work items linked to the selected commit: Azure DevOps links (from the
// commit batch API) plus `AB#NNN` mentions in the commit message. Each row shows
// the item's title and state and jumps to it in the Work Items view. Hidden when
// there are none; a failed lookup still shows the message mentions.
export function CommitLinkedWorkItemsPanel({ commit }: { commit: CommitSummary }) {
  const linksQuery = useQuery({
    queryKey: ["commitWorkItems", commit.organizationId, commit.repositoryId, commit.commitId],
    queryFn: () =>
      listCommitWorkItems({
        organizationId: commit.organizationId,
        projectId: commit.projectId,
        repositoryId: commit.repositoryId,
        commitId: commit.commitId,
      }),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const ids = [
    ...new Set([...(linksQuery.data ?? []), ...extractWorkItemMentions([commit.comment])]),
  ].sort((a, b) => a - b);

  const previews = useQueries({
    queries: ids.map((id) => ({
      queryKey: workItemQueryKeys.preview(commit.organizationId, commit.projectId, id, ""),
      queryFn: () =>
        getWorkItemPreview({
          organizationId: commit.organizationId,
          projectId: commit.projectId,
          workItemId: id,
        }),
      staleTime: 30_000,
      retry: false,
    })),
  });

  if (linksQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading linked work
        items…
      </div>
    );
  }
  if (ids.length === 0) return null;

  return (
    <div className="border-t border-border">
      <PreviewBand>
        {ids.length} linked work item{ids.length === 1 ? "" : "s"}
      </PreviewBand>
      <ul>
        {ids.map((id, index) => {
          const preview = previews[index]?.data;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() =>
                  navigateToWorkItem({ organizationId: commit.organizationId, workItemId: id })
                }
                onKeyDown={(event) => {
                  // Keep Enter/Space on the button; do not let the preview's
                  // Esc/Arrow handler hijack activation.
                  if (event.key === "Enter" || event.key === " ") event.stopPropagation();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/50 focus:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                title={`Open #${id} in Work Items`}
              >
                <span className="shrink-0 font-mono text-muted-foreground">#{id}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {preview?.title ?? "…"}
                </span>
                {preview?.state ? (
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                    <span
                      className={`h-2 w-2 rounded-full ${workItemStateDotClass(preview.state)}`}
                      aria-hidden="true"
                    />
                    {preview.state}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
