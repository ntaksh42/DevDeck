import { type KeyboardEvent as ReactKeyboardEvent, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitPullRequest, Loader2 } from "lucide-react";
import {
  type BranchOverviewItem,
  commandErrorMessage,
  listRepoBranchOverview,
  type Organization,
} from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { navigateToPullRequest } from "@/lib/crossLinks";
import { formatRelativeDate } from "@/lib/utils";
import { ErrorState } from "@/components/StateDisplay";
import { CreatePullRequestDialog } from "./CreatePullRequestDialog";
import {
  branchCompareUrl,
  formatDate,
  handleRowNavKey,
  pullRequestUrl,
  type RepoOption,
} from "./codeBrowseShared";

const LINK_BUTTON = "text-xs text-link hover:underline";

// The Files > Branches tab: every branch with its last update, how far it is
// ahead of / behind the default branch, and its active pull requests. Actions
// browse the branch here or jump to Azure DevOps to compare / open a PR.
export function CodeBranchesView({
  organization,
  organizationId,
  repo,
  onBrowseBranch,
}: {
  organization: Organization | undefined;
  organizationId: string;
  repo: RepoOption;
  onBrowseBranch: (branch: string) => void;
}) {
  const query = useQuery({
    queryKey: ["repoBranchOverview", organizationId, repo.repositoryId],
    queryFn: () =>
      listRepoBranchOverview({
        organizationId,
        project: repo.projectId,
        repository: repo.repositoryId,
      }),
    staleTime: 60_000,
  });
  const queryClient = useQueryClient();
  const [creatingFrom, setCreatingFrom] = useState<BranchOverviewItem | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    handleRowNavKey(event, containerRef.current, "[data-branch-item]");
  }

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  }
  if (query.isError) return <ErrorState message={commandErrorMessage(query.error)} />;
  const branches = query.data ?? [];
  if (branches.length === 0) {
    return <div className="px-3 py-3 text-sm text-muted-foreground">No branches.</div>;
  }
  const defaultBranch = branches.find((branch) => branch.isDefault)?.name;

  return (
    <div ref={containerRef} onKeyDown={onKeyDown}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-3 py-1.5 font-medium">Branch</th>
            <th
              className="px-3 py-1.5 font-medium"
              title={`Commits behind | ahead of ${defaultBranch ?? "the default branch"}`}
            >
              Behind | Ahead
            </th>
            <th className="px-3 py-1.5 font-medium">Last update</th>
            <th className="px-3 py-1.5 font-medium">Pull requests</th>
            <th className="px-3 py-1.5 font-medium" />
          </tr>
        </thead>
        <tbody>
          {branches.map((branch) => (
            <BranchRow
              key={branch.name}
              branch={branch}
              defaultBranch={defaultBranch}
              organization={organization}
              repo={repo}
              onBrowseBranch={onBrowseBranch}
              onCreatePullRequest={setCreatingFrom}
            />
          ))}
        </tbody>
      </table>
      {creatingFrom && defaultBranch ? (
        <CreatePullRequestDialog
          organizationId={organizationId}
          repo={repo}
          branches={branches.map((branch) => branch.name)}
          initialSource={creatingFrom.name}
          initialTarget={defaultBranch}
          initialTitle={creatingFrom.lastComment ?? creatingFrom.name}
          onClose={() => setCreatingFrom(null)}
          onCreated={(pullRequest) => {
            setCreatingFrom(null);
            void queryClient.invalidateQueries({
              queryKey: ["repoBranchOverview", organizationId, repo.repositoryId],
            });
            navigateToPullRequest({
              organizationId,
              repositoryId: repo.repositoryId,
              pullRequestId: pullRequest.pullRequestId,
            });
          }}
        />
      ) : null}
    </div>
  );
}

function BranchRow({
  branch,
  defaultBranch,
  organization,
  repo,
  onBrowseBranch,
  onCreatePullRequest,
}: {
  branch: BranchOverviewItem;
  defaultBranch: string | undefined;
  organization: Organization | undefined;
  repo: RepoOption;
  onBrowseBranch: (branch: string) => void;
  onCreatePullRequest: (branch: BranchOverviewItem) => void;
}) {
  const canCompare = !!defaultBranch && !branch.isDefault;
  const canOpenPr = canCompare && branch.ahead > 0 && branch.pullRequests.length === 0;
  return (
    <tr className="border-b border-border/60 align-top hover:bg-muted/50">
      <td className="px-3 py-1.5">
        <button
          type="button"
          data-branch-item
          onClick={() => onBrowseBranch(branch.name)}
          className="text-left font-medium text-link hover:underline"
          title="Browse this branch"
        >
          {branch.name}
        </button>
        {branch.isDefault ? (
          <span className="ml-2 rounded border border-border px-1 text-[10px] text-muted-foreground">
            default
          </span>
        ) : null}
        {branch.lastComment ? (
          <div className="truncate text-xs text-muted-foreground" title={branch.lastComment}>
            {branch.lastComment}
          </div>
        ) : null}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs tabular-nums">
        {branch.isDefault ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <>
            <span className={branch.behind > 0 ? "text-amber-600 dark:text-amber-400" : ""}>
              {branch.behind}
            </span>
            {" | "}
            <span className={branch.ahead > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}>
              {branch.ahead}
            </span>
          </>
        )}
      </td>
      <td
        className="whitespace-nowrap px-3 py-1.5 text-muted-foreground"
        title={branch.lastDate ? formatDate(branch.lastDate) : undefined}
      >
        {branch.lastAuthor ?? ""}
        {branch.lastDate ? ` · ${formatRelativeDate(branch.lastDate)}` : ""}
      </td>
      <td className="px-3 py-1.5">
        {branch.pullRequests.map((pr) => (
          <button
            key={pr.pullRequestId}
            type="button"
            onClick={() => openExternalUrl(pullRequestUrl(organization, repo, pr.pullRequestId))}
            className="flex max-w-[16rem] items-center gap-1 text-xs text-link hover:underline"
            title={`${pr.isDraft ? "Draft: " : ""}${pr.title} — open in Azure DevOps`}
          >
            <GitPullRequest className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              !{pr.pullRequestId} {pr.title}
            </span>
          </button>
        ))}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5">
        <div className="flex items-center gap-3">
          {canCompare ? (
            <button
              type="button"
              onClick={() =>
                openExternalUrl(branchCompareUrl(organization, repo, defaultBranch, branch.name))
              }
              className={LINK_BUTTON}
              title={`Compare with ${defaultBranch} in Azure DevOps`}
            >
              Compare
            </button>
          ) : null}
          {canOpenPr ? (
            <button
              type="button"
              onClick={() => onCreatePullRequest(branch)}
              className={LINK_BUTTON}
              title={`Create a pull request into ${defaultBranch}`}
            >
              New PR
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
