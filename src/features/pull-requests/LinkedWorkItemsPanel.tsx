import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  commandErrorMessage,
  getPullRequestReview,
  getWorkItemPreview,
  listPullRequestCommits,
  listPullRequestWorkItems,
  prLocator,
  type ReviewPullRequestSummary,
  type WorkItemPreview,
  type WorkItemSummary,
} from "@/lib/azdoCommands";
import { extractWorkItemMentions } from "@/lib/crossLinks";
import { focusPrimaryGrid } from "@/lib/utils";
import { ErrorState, LoadingState, PreviewEmptyState } from "@/components/StateDisplay";
import { WorkItemPreviewPanel } from "@/features/work-items/WorkItemPreviewPanel";
import { workItemQueryKeys } from "@/features/work-items/queryKeys";
import { workItemStateDotClass } from "@/features/work-items/WorkItemPreviewDetails";

export const LINKED_WORK_ITEMS_PANEL_ID = "linkedWorkItems";
const CHOOSER_ATTR = "data-linked-work-item-chooser";

function summaryFor(
  pr: ReviewPullRequestSummary,
  id: number,
  preview: WorkItemPreview | undefined,
): WorkItemSummary {
  return {
    organizationId: pr.organizationId,
    projectId: preview?.projectId ?? pr.projectId,
    projectName: preview?.projectName ?? "",
    id,
    title: preview?.title ?? "",
    workItemType: preview?.workItemType ?? null,
    state: preview?.state ?? null,
    assignedTo: preview?.assignedTo ?? null,
    changedDate: preview?.changedDate ?? null,
    webUrl: preview?.webUrl ?? null,
    tags: preview?.tags ?? null,
    extraFields: [],
    depth: null,
    hasActivePullRequest: false,
    hasDraftPullRequest: false,
  };
}

/** Work items linked to the PR: Azure DevOps links plus `AB#NNN` mentions. */
function useLinkedWorkItemIds(pr: ReviewPullRequestSummary): {
  ids: number[];
  loading: boolean;
  error: string | null;
} {
  const linksQuery = useQuery({
    queryKey: ["prWorkItems", pr.organizationId, pr.repositoryId, pr.pullRequestId],
    queryFn: () => listPullRequestWorkItems(prLocator(pr)),
    staleTime: 60_000,
  });
  // Same keys as the Conversation tab, so these are cache hits once it loaded;
  // they only add AB# mentions the API link list does not carry.
  const reviewQuery = useQuery({
    queryKey: ["prReview", pr.organizationId, pr.repositoryId, pr.pullRequestId],
    queryFn: () => getPullRequestReview(prLocator(pr)),
    staleTime: 60_000,
  });
  const commitsQuery = useQuery({
    queryKey: ["prCommits", pr.organizationId, pr.repositoryId, pr.pullRequestId],
    queryFn: () => listPullRequestCommits(prLocator(pr)),
    staleTime: 60_000,
  });
  const ids = useMemo(() => {
    const merged = new Set<number>(linksQuery.data ?? []);
    for (const id of extractWorkItemMentions([
      reviewQuery.data?.description,
      ...(commitsQuery.data?.map((commit) => commit.comment) ?? []),
    ])) {
      merged.add(id);
    }
    return [...merged].sort((a, b) => a - b);
  }, [linksQuery.data, reviewQuery.data, commitsQuery.data]);
  return {
    ids,
    loading: linksQuery.isLoading,
    error: linksQuery.isError && ids.length === 0 ? commandErrorMessage(linksQuery.error) : null,
  };
}

export function LinkedWorkItemsPanel({ pr }: { pr: ReviewPullRequestSummary }) {
  const { ids, loading, error } = useLinkedWorkItemIds(pr);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const activeId = selectedId !== null && ids.includes(selectedId) ? selectedId : (ids[0] ?? null);

  const previewQueries = useQueries({
    queries: ids.map((id) => ({
      queryKey: workItemQueryKeys.preview(pr.organizationId, pr.projectId, id, ""),
      queryFn: () =>
        getWorkItemPreview({ organizationId: pr.organizationId, projectId: pr.projectId, workItemId: id }),
      staleTime: 30_000,
    })),
  });
  const previews = new Map<number, WorkItemPreview | undefined>(
    ids.map((id, index) => [id, previewQueries[index]?.data]),
  );

  // A different PR starts over on its first work item.
  useEffect(() => setSelectedId(null), [pr.organizationId, pr.repositoryId, pr.pullRequestId]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (activeId === null) return <PreviewEmptyState message="No linked work items." />;

  const activeIndex = ids.indexOf(activeId);
  const activeQuery = previewQueries[activeIndex];
  const activePreview = previews.get(activeId);

  function handleChooserKeyDown(event: React.KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    let next = activeIndex;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = Math.min(ids.length - 1, activeIndex + 1);
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = Math.max(0, activeIndex - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      focusPrimaryGrid();
      return;
    } else return;
    // Keep the arrows inside the chooser so the underlying grid stays put.
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(ids[next]);
    window.setTimeout(
      () => document.querySelector<HTMLElement>(`[${CHOOSER_ATTR}] [aria-checked='true']`)?.focus(),
      0,
    );
  }

  return (
    <div data-linked-work-items="true" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card">
      {ids.length > 1 ? (
        <div
          role="radiogroup"
          aria-label="Linked work items"
          {...{ [CHOOSER_ATTR]: "true" }}
          onKeyDown={handleChooserKeyDown}
          className="flex max-h-32 shrink-0 flex-col overflow-y-auto border-b border-border"
        >
          {ids.map((id) => {
            const preview = previews.get(id);
            const checked = id === activeId;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                onClick={() => setSelectedId(id)}
                className={`flex items-center gap-2 px-3 py-1 text-left text-xs focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
                  checked ? "bg-secondary font-medium" : "hover:bg-secondary/60"
                }`}
              >
                <span className="shrink-0 font-mono text-muted-foreground">#{id}</span>
                {preview?.state ? (
                  <span className={`h-2 w-2 shrink-0 rounded-full ${workItemStateDotClass(preview.state)}`} aria-hidden="true" />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{preview?.title ?? "Loading..."}</span>
                {preview?.workItemType ? (
                  <span className="shrink-0 text-muted-foreground">{preview.workItemType}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
      <div
        className="min-h-0 flex-1"
        onKeyDown={(event) => {
          if (event.key === "Escape" && event.target instanceof HTMLElement && !event.target.closest("input, textarea, [contenteditable='true']")) {
            event.preventDefault();
            focusPrimaryGrid();
          }
        }}
      >
        <WorkItemPreviewPanel
          customPreviewFields={[]}
          onCustomPreviewFieldsChange={() => undefined}
          preview={activePreview ?? null}
          previewError={activeQuery?.isError ? commandErrorMessage(activeQuery.error) : null}
          previewLoading={activeQuery?.isLoading ?? false}
          selectedItem={summaryFor(pr, activeId, activePreview)}
        />
      </div>
    </div>
  );
}

/** Focuses the chooser (or the panel itself when there is a single item). */
export function focusLinkedWorkItems(): void {
  const target =
    document.querySelector<HTMLElement>(`[${CHOOSER_ATTR}] [aria-checked='true']`) ??
    document.querySelector<HTMLElement>("[data-linked-work-items] [tabindex], [data-linked-work-items] button");
  target?.focus();
}
