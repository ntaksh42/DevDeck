import { useQuery } from "@tanstack/react-query";
import { GitBranch, GitPullRequestArrow } from "lucide-react";
import { listBranchSummaries, commandErrorMessage, type BranchSummary } from "@/lib/azdoCommands";
import { formatRelativeDate } from "@/lib/utils";
import { ErrorState, LoadingState } from "@/components/StateDisplay";

// Read-only branch overview for the repository selected in PR search (issue
// #398): last update, ahead/behind vs. the default branch, and the active PR
// (if any) that uses the branch as its source. "New PR" jumps into the create
// form (issue #387) prefilled with that branch as the source.
export function BranchesPanel({
  organizationId,
  project,
  repository,
  onOpenPullRequest,
  onCreatePrFromBranch,
}: {
  organizationId?: string;
  project: string;
  repository: string;
  onOpenPullRequest: (url: string) => void;
  onCreatePrFromBranch?: (branchName: string) => void;
}) {
  const branchesQuery = useQuery({
    queryKey: ["prBranchSummaries", organizationId, project, repository],
    queryFn: () => listBranchSummaries({ organizationId, project, repository }),
    staleTime: 60_000,
  });
  const branches = branchesQuery.data ?? [];

  return (
    <div className="shrink-0 rounded-md border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium">
        <GitBranch className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Branches
        {!branchesQuery.isLoading && !branchesQuery.isError ? (
          <span className="text-xs font-normal text-muted-foreground">{branches.length}</span>
        ) : null}
      </div>
      {branchesQuery.isLoading ? (
        <LoadingState />
      ) : branchesQuery.isError ? (
        <ErrorState message={commandErrorMessage(branchesQuery.error)} />
      ) : branches.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">No branches found.</p>
      ) : (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">Branch</th>
                <th className="px-3 py-1.5 font-medium">Ahead / Behind</th>
                <th className="px-3 py-1.5 font-medium">Last update</th>
                <th className="px-3 py-1.5 font-medium">Pull request</th>
                <th className="px-3 py-1.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {branches.map((branch) => (
                <BranchRow
                  key={branch.name}
                  branch={branch}
                  onOpenPullRequest={onOpenPullRequest}
                  onCreatePrFromBranch={onCreatePrFromBranch}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BranchRow({
  branch,
  onOpenPullRequest,
  onCreatePrFromBranch,
}: {
  branch: BranchSummary;
  onOpenPullRequest: (url: string) => void;
  onCreatePrFromBranch?: (branchName: string) => void;
}) {
  const hasPr = branch.pullRequestId != null && !!branch.pullRequestUrl;
  return (
    <tr className="border-t border-border/60">
      <td className="px-3 py-1.5">
        <span className="font-medium">{branch.name}</span>
        {branch.isBaseVersion ? (
          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
            default
          </span>
        ) : null}
      </td>
      <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
        <span className="text-emerald-600 dark:text-emerald-400">↑{branch.aheadCount}</span>{" "}
        <span className="text-amber-600 dark:text-amber-400">↓{branch.behindCount}</span>
      </td>
      <td className="px-3 py-1.5 text-muted-foreground">
        {branch.lastUpdated ? formatRelativeDate(branch.lastUpdated) : "—"}
        {branch.lastAuthor ? ` · ${branch.lastAuthor}` : ""}
      </td>
      <td className="px-3 py-1.5">
        {hasPr ? (
          <button
            type="button"
            onClick={() => onOpenPullRequest(branch.pullRequestUrl as string)}
            className="text-primary hover:underline"
            title={branch.pullRequestTitle ?? undefined}
          >
            #{branch.pullRequestId}
          </button>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-1.5">
        {!branch.isBaseVersion && !hasPr && onCreatePrFromBranch ? (
          <button
            type="button"
            onClick={() => onCreatePrFromBranch(branch.name)}
            title="Create a pull request from this branch"
            className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs hover:bg-accent"
          >
            <GitPullRequestArrow className="h-3 w-3" aria-hidden="true" />
            New PR
          </button>
        ) : null}
      </td>
    </tr>
  );
}
