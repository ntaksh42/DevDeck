import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { commandErrorMessage, listRepoHistory, type Organization } from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { ErrorState } from "@/components/StateDisplay";
import { commitUrl, formatDate, type RepoOption } from "./codeBrowseShared";

const HISTORY_PAGE_SIZE = 50;

// The Files > History tab: the commit history of the selected file or folder at
// the current branch, paged in with "Load more".
export function CodeHistoryView({
  organization,
  organizationId,
  repo,
  branch,
  path,
}: {
  organization: Organization | undefined;
  organizationId: string;
  repo: RepoOption;
  branch: string;
  path: string;
}) {
  const query = useInfiniteQuery({
    queryKey: ["repoHistory", organizationId, repo.repositoryId, branch, path],
    queryFn: ({ pageParam }) =>
      listRepoHistory({
        organizationId,
        project: repo.projectId,
        repository: repo.repositoryId,
        branch,
        path,
        top: HISTORY_PAGE_SIZE,
        skip: pageParam,
      }),
    enabled: !!branch,
    staleTime: 60_000,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      // A short final page means we've reached the end of the history.
      lastPage.length < HISTORY_PAGE_SIZE
        ? undefined
        : allPages.reduce((sum, page) => sum + page.length, 0),
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
  const commits = query.data?.pages.flat() ?? [];
  if (commits.length === 0) {
    return <div className="px-3 py-3 text-sm text-muted-foreground">No commit history.</div>;
  }

  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-3 py-1.5 font-medium">Commit</th>
            <th className="px-3 py-1.5 font-medium">Message</th>
            <th className="px-3 py-1.5 font-medium">Author</th>
            <th className="px-3 py-1.5 font-medium">Date</th>
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
            </tr>
          ))}
        </tbody>
      </table>
      {query.hasNextPage ? (
        <div className="px-3 py-2">
          <button
            type="button"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-input py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {query.isFetchingNextPage ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading…
              </>
            ) : (
              "Load more"
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}
