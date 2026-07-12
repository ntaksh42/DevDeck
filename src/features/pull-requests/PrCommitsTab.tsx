import { useQuery } from "@tanstack/react-query";
import {
  commandErrorMessage,
  listPullRequestCommits,
  prLocator,
  type ReviewPullRequestSummary,
} from "@/lib/azdoCommands";
import { ErrorState, LoadingState, PreviewEmptyState } from "@/components/StateDisplay";
import { openExternalUrl } from "@/lib/openExternal";
import { formatDate, formatRelativeDate } from "@/lib/utils";

export function CommitsTab({ pr }: { pr: ReviewPullRequestSummary }) {
  const commitsQuery = useQuery({
    queryKey: ["prCommits", pr.organizationId, pr.repositoryId, pr.pullRequestId],
    queryFn: () => listPullRequestCommits(prLocator(pr)),
    staleTime: 60_000,
  });

  if (commitsQuery.isLoading) return <LoadingState />;
  if (commitsQuery.isError) {
    return (
      <ErrorState
        message={commandErrorMessage(commitsQuery.error)}
        onRetry={() => void commitsQuery.refetch()}
      />
    );
  }
  const commits = commitsQuery.data ?? [];
  if (commits.length === 0) return <PreviewEmptyState message="No commits." />;

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto outline-none"
      data-primary-preview="true"
      aria-keyshortcuts="Control+P"
      tabIndex={-1}
    >
      {commits.map((commit) => (
        <div
          key={commit.commitId}
          className="flex items-center gap-2 border-b border-border px-2 py-1.5 text-xs"
        >
          <button
            type="button"
            onClick={() => commit.webUrl && openExternalUrl(commit.webUrl)}
            disabled={!commit.webUrl}
            className="shrink-0 rounded border border-border bg-muted px-1.5 py-px font-mono text-[11px] text-primary hover:bg-secondary disabled:text-muted-foreground"
            title={commit.commitId}
          >
            {commit.shortCommitId}
          </button>
          <span className="min-w-0 flex-1 truncate text-foreground" title={commit.comment}>
            {commit.comment}
          </span>
          <span className="shrink-0 text-muted-foreground">{commit.authorName ?? ""}</span>
          {commit.authorDate ? (
            <span className="shrink-0 text-muted-foreground" title={formatDate(commit.authorDate)}>
              {formatRelativeDate(commit.authorDate)}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
