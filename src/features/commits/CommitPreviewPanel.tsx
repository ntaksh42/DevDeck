import { type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitPullRequest, Loader2, Maximize2, Minimize2 } from "lucide-react";
import {
  type CommitSummary,
  type CommitPullRequest,
  commandErrorMessage,
  getCommitPullRequests,
  getCommitWorkItems,
} from "@/lib/azdoCommands";
import { isEditableTarget, focusPrimaryGrid, formatDate } from "@/lib/utils";
import { openExternalUrl } from "@/lib/openExternal";
import { navigateToWorkItem } from "@/lib/crossLinks";
import { WorkItemStatePill, WorkItemTypeBadge } from "@/features/work-items/WorkItemBadges";
import { CommitFilesPanel } from "./CommitFilesPanel";
import { PR_STATUS_LABELS } from "./commitSearchConstants";
import { commitPrQueryKey, prStatusBadgeClass } from "./commitSearchUtils";

// Lists the work items linked to the selected commit via Azure DevOps's
// artifact link mechanism. Hidden when the commit has no linked work items,
// matching the related-PRs panel above it.
function CommitWorkItemsPanel({ commit }: { commit: CommitSummary }) {
  const workItemsQuery = useQuery({
    queryKey: ["commitWorkItems", commit.organizationId, commit.repositoryId, commit.commitId],
    queryFn: () =>
      getCommitWorkItems({
        organizationId: commit.organizationId,
        projectId: commit.projectId,
        projectName: commit.projectName,
        repositoryId: commit.repositoryId,
        commitId: commit.commitId,
      }),
    staleTime: 5 * 60_000,
  });

  if (workItemsQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading linked work
        items…
      </div>
    );
  }
  if (workItemsQuery.isError) {
    return (
      <p className="border-t border-border px-3 py-2 text-xs text-destructive">
        {commandErrorMessage(workItemsQuery.error)}
      </p>
    );
  }
  const workItems = workItemsQuery.data ?? [];
  if (workItems.length === 0) return null;

  return (
    <div className="border-t border-border">
      <div className="border-b border-border bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
        {workItems.length} linked work item{workItems.length === 1 ? "" : "s"}
      </div>
      <ul>
        {workItems.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => navigateToWorkItem({ organizationId: item.organizationId, workItemId: item.id })}
              onKeyDown={(event) => {
                // Keep Enter/Space on the button; don't let the preview's
                // Esc/Arrow handler hijack activation.
                if (event.key === "Enter" || event.key === " ") {
                  event.stopPropagation();
                }
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/50 focus:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              title={`Open work item ${item.id} in Work Items`}
            >
              <span className="shrink-0 font-mono text-muted-foreground">#{item.id}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{item.title}</span>
              {item.workItemType ? <WorkItemTypeBadge type={item.workItemType} /> : null}
              {item.state ? <WorkItemStatePill state={item.state} /> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Lists the PRs that contain the selected commit. This is the query that
// actually fetches; the grid indicator reads the same cache passively. Renders
// nothing when the commit is in no PRs (per the issue's "hide if none" rule).
function CommitRelatedPrsPanel({
  commit,
  onOpenPullRequest,
}: {
  commit: CommitSummary;
  onOpenPullRequest?: (query: string, organizationId?: string) => void;
}) {
  const prsQuery = useQuery({
    queryKey: commitPrQueryKey(commit),
    queryFn: () => getCommitPullRequests(commit),
    staleTime: 5 * 60_000,
  });

  if (prsQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading related pull
        requests…
      </div>
    );
  }
  if (prsQuery.isError) {
    return (
      <p className="border-t border-border px-3 py-2 text-xs text-destructive">
        {commandErrorMessage(prsQuery.error)}
      </p>
    );
  }
  const prs = prsQuery.data ?? [];
  if (prs.length === 0) return null;

  function openPr(pr: CommitPullRequest) {
    onOpenPullRequest?.(String(pr.pullRequestId), commit.organizationId);
  }

  return (
    <div className="border-t border-border">
      <div className="border-b border-border bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
        {prs.length} related pull request{prs.length === 1 ? "" : "s"}
      </div>
      <ul>
        {prs.map((pr) => (
          <li key={pr.pullRequestId}>
            <button
              type="button"
              onClick={() => openPr(pr)}
              onKeyDown={(event) => {
                // Keep Enter/Space on the button; don't let the preview's
                // Esc/Arrow handler hijack activation.
                if (event.key === "Enter" || event.key === " ") {
                  event.stopPropagation();
                }
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/50 focus:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              title={`Open !${pr.pullRequestId} in Pull Request search`}
            >
              <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span className="shrink-0 font-mono text-muted-foreground">!{pr.pullRequestId}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{pr.title}</span>
              <span
                className={`shrink-0 rounded border px-1 py-px text-[10px] font-semibold ${prStatusBadgeClass(pr.status)}`}
              >
                {PR_STATUS_LABELS[pr.status.toLowerCase()] ?? pr.status}
              </span>
              {pr.myVote !== 0 ? (
                <span className="shrink-0 text-[10px] text-muted-foreground" title="Your vote">
                  {pr.myVoteLabel}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CommitPreviewPanel({
  commit,
  maximized,
  onToggleMaximize,
  onOpenPullRequest,
}: {
  commit: CommitSummary | null;
  maximized: boolean;
  onToggleMaximize: () => void;
  onOpenPullRequest?: (query: string, organizationId?: string) => void;
}) {
  // Esc / ← step back to the grid (mirrors the grid's Enter / → into here).
  function handleKeyDown(event: ReactKeyboardEvent) {
    if (isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusPrimaryGrid();
    }
  }

  return (
    <aside
      onKeyDown={handleKeyDown}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card focus-within:ring-2 focus-within:ring-ring"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        {commit ? (
          <span className="shrink-0 font-mono text-xs font-semibold text-primary" title={commit.commitId}>
            {commit.shortCommitId}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">No commit selected</span>
        )}
        {commit?.webUrl ? (
          <button
            type="button"
            onClick={() => openExternalUrl(commit.webUrl as string)}
            title="Open in Azure DevOps (O)"
            className="ml-auto shrink-0 rounded border border-border bg-card px-1.5 py-px text-[11px] text-primary hover:bg-secondary"
          >
            Open
          </button>
        ) : null}
        <button
          type="button"
          onClick={onToggleMaximize}
          aria-pressed={maximized}
          aria-label={maximized ? "Restore split view" : "Maximize preview"}
          title={`${maximized ? "Restore split view" : "Maximize preview"} (\\)`}
          className={`shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring ${
            commit?.webUrl ? "" : "ml-auto"
          }`}
        >
          {maximized ? (
            <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto outline-none"
        data-primary-preview="true"
        aria-keyshortcuts="Control+P"
        tabIndex={-1}
      >
        {commit ? (
          <>
            <div className="px-3 py-2">
              <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                {commit.comment || "(no comment)"}
              </p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <dt>Author</dt>
                <dd className="text-foreground">
                  {commit.authorName ?? "—"}
                  {commit.authorEmail ? ` <${commit.authorEmail}>` : ""}
                </dd>
                <dt>Date</dt>
                <dd className="text-foreground">
                  {commit.authorDate ? formatDate(commit.authorDate) : "—"}
                </dd>
                <dt>Repository</dt>
                <dd className="text-foreground">
                  {commit.projectName} / {commit.repositoryName}
                </dd>
                <dt>Commit</dt>
                <dd className="break-all font-mono text-foreground">{commit.commitId}</dd>
              </dl>
            </div>
            <CommitRelatedPrsPanel commit={commit} onOpenPullRequest={onOpenPullRequest} />
            <CommitWorkItemsPanel commit={commit} />
            <CommitFilesPanel
              key={`${commit.organizationId}:${commit.repositoryId}:${commit.commitId}`}
              organizationId={commit.organizationId}
              projectId={commit.projectId}
              repositoryId={commit.repositoryId}
              commitId={commit.commitId}
              commitWebUrl={commit.webUrl}
            />
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-sm text-muted-foreground">
            Select a commit.
          </div>
        )}
      </div>
    </aside>
  );
}
