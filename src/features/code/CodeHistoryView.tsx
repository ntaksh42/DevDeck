import { useQuery } from "@tanstack/react-query";
import { GitCompare, Loader2 } from "lucide-react";
import { commandErrorMessage, listRepoHistory, type Organization } from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { ErrorState } from "@/components/StateDisplay";
import { commitUrl, formatDate, type RepoOption } from "./codeBrowseShared";

// The Files > History tab: the commit history of the selected file or folder at
// the current branch.
export function CodeHistoryView({
  organization,
  organizationId,
  repo,
  branch,
  path,
  onOpenCommit,
}: {
  organization: Organization | undefined;
  organizationId: string;
  repo: RepoOption;
  branch: string;
  path: string;
  // Navigates to the Commits view searched for this commit, reusing the
  // existing commit diff infrastructure instead of duplicating it here.
  onOpenCommit?: (query: string, organizationId?: string) => void;
}) {
  const query = useQuery({
    queryKey: ["repoHistory", organizationId, repo.repositoryId, branch, path],
    queryFn: () =>
      listRepoHistory({
        organizationId,
        project: repo.projectId,
        repository: repo.repositoryId,
        branch,
        path,
      }),
    enabled: !!branch,
    staleTime: 60_000,
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  }
  if (query.isError) {
    return <ErrorState message={commandErrorMessage(query.error)} />;
  }
  const commits = query.data ?? [];
  if (commits.length === 0) {
    return <div className="px-3 py-3 text-sm text-muted-foreground">No commit history.</div>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs text-muted-foreground">
          <th className="px-3 py-1.5 font-medium">Commit</th>
          <th className="px-3 py-1.5 font-medium">Message</th>
          <th className="px-3 py-1.5 font-medium">Author</th>
          <th className="px-3 py-1.5 font-medium">Date</th>
          <th className="px-3 py-1.5 font-medium" />
        </tr>
      </thead>
      <tbody>
        {commits.map((commit) => (
          <tr key={commit.commitId} className="border-b border-border/60 hover:bg-muted/50">
            <td className="px-3 py-1.5">
              <button
                type="button"
                onClick={() => openExternalUrl(commitUrl(organization, repo, commit.commitId))}
                className="font-mono text-xs text-primary hover:underline"
                title="Open commit in Azure DevOps"
              >
                {commit.shortId}
              </button>
            </td>
            <td className="px-3 py-1.5">{commit.message}</td>
            <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
              {commit.author ?? ""}
            </td>
            <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
              {formatDate(commit.date)}
            </td>
            <td className="px-3 py-1.5 text-right">
              {onOpenCommit ? (
                <button
                  type="button"
                  onClick={() => onOpenCommit(commit.commitId, organizationId)}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                  title="View this commit's diff in Commits"
                >
                  <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
                  Diff
                </button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
