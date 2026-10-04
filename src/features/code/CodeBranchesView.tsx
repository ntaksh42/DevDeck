import { type KeyboardEvent as ReactKeyboardEvent, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitPullRequest, Loader2 } from "lucide-react";
import {
  type BranchOverviewItem,
  commandErrorMessage,
  deleteRepoBranch,
  listRepoBranchOverview,
  type Organization,
} from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { navigateToPullRequest } from "@/lib/crossLinks";
import { formatRelativeDate } from "@/lib/utils";
import { ConfirmDialog, useConfirm } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/StateDisplay";
import { CreateBranchDialog } from "./CreateBranchDialog";
import { BranchPoliciesDialog } from "./BranchPoliciesDialog";
import { CreatePullRequestDialog } from "./CreatePullRequestDialog";
import { CreateTagDialog } from "./CreateTagDialog";
import { CodeTagsSection, repoTagOverviewKey } from "./CodeTagsSection";
import {
  branchCompareUrl,
  branchPoliciesUrl,
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
  const [branchingFrom, setBranchingFrom] = useState<BranchOverviewItem | null>(null);
  const [taggingFrom, setTaggingFrom] = useState<BranchOverviewItem | null>(null);
  const [policiesFor, setPoliciesFor] = useState<BranchOverviewItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { confirm, dialogProps } = useConfirm();

  function refreshBranches() {
    void queryClient.invalidateQueries({ queryKey: ["repoBranchOverview", organizationId, repo.repositoryId] });
    void queryClient.invalidateQueries({ queryKey: ["repoBranches", organizationId, repo.projectId, repo.repositoryId] });
  }
  const deleteBranch = useMutation({
    mutationFn: (branch: BranchOverviewItem) =>
      deleteRepoBranch({
        organizationId,
        project: repo.projectId,
        repository: repo.repositoryId,
        name: branch.name,
        commitId: branch.lastCommitId as string,
      }),
    onSuccess: () => {
      setDeleteError(null);
      refreshBranches();
    },
    onError: (error) => setDeleteError(commandErrorMessage(error)),
  });
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
      {deleteError ? (
        <div role="alert" className="border-b border-border bg-red-50 px-3 py-1 text-xs text-destructive dark:bg-red-950/40">
          {deleteError}
        </div>
      ) : null}
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
              onCreateBranch={setBranchingFrom}
              onCreateTag={setTaggingFrom}
              onShowPolicies={setPoliciesFor}
              onDelete={(target) =>
                confirm({
                  title: "Delete branch",
                  message: `Delete branch ${target.name}? Commits only on this branch become unreachable.`,
                  confirmLabel: "Delete",
                  destructive: true,
                  onConfirm: () => deleteBranch.mutate(target),
                })
              }
              busy={deleteBranch.isPending}
            />
          ))}
        </tbody>
      </table>
      <CodeTagsSection organizationId={organizationId} repo={repo} />
      {dialogProps ? <ConfirmDialog {...dialogProps} /> : null}
      {policiesFor ? (
        <BranchPoliciesDialog
          organizationId={organizationId}
          repo={repo}
          branch={policiesFor.name}
          policiesUrl={branchPoliciesUrl(organization, repo, policiesFor.name)}
          onClose={() => setPoliciesFor(null)}
        />
      ) : null}
      {taggingFrom?.lastCommitId ? (
        <CreateTagDialog
          organizationId={organizationId}
          repo={repo}
          sourceName={taggingFrom.name}
          commitId={taggingFrom.lastCommitId}
          onClose={() => setTaggingFrom(null)}
          onCreated={() => {
            setTaggingFrom(null);
            void queryClient.invalidateQueries({
              queryKey: repoTagOverviewKey(organizationId, repo.repositoryId),
            });
          }}
        />
      ) : null}
      {branchingFrom?.lastCommitId ? (
        <CreateBranchDialog
          organizationId={organizationId}
          repo={repo}
          sourceName={branchingFrom.name}
          sourceCommitId={branchingFrom.lastCommitId}
          onClose={() => setBranchingFrom(null)}
          onCreated={() => {
            setBranchingFrom(null);
            refreshBranches();
          }}
        />
      ) : null}
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
  onCreateBranch,
  onCreateTag,
  onShowPolicies,
  onDelete,
  busy,
}: {
  branch: BranchOverviewItem;
  defaultBranch: string | undefined;
  organization: Organization | undefined;
  repo: RepoOption;
  onBrowseBranch: (branch: string) => void;
  onCreatePullRequest: (branch: BranchOverviewItem) => void;
  onCreateBranch: (branch: BranchOverviewItem) => void;
  onCreateTag: (branch: BranchOverviewItem) => void;
  onShowPolicies: (branch: BranchOverviewItem) => void;
  onDelete: (branch: BranchOverviewItem) => void;
  busy: boolean;
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
          {branch.lastCommitId ? (
            <button
              type="button"
              onClick={() => onCreateBranch(branch)}
              className={LINK_BUTTON}
              title={`Create a new branch from ${branch.name}`}
            >
              Branch
            </button>
          ) : null}
          {branch.lastCommitId ? (
            <button
              type="button"
              onClick={() => onCreateTag(branch)}
              className={LINK_BUTTON}
              title={`Create a tag at the tip of ${branch.name}`}
            >
              Tag
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onShowPolicies(branch)}
            className={LINK_BUTTON}
            title={`Show the branch policies that apply to ${branch.name}`}
          >
            Policies
          </button>
          {!branch.isDefault && branch.lastCommitId ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDelete(branch)}
              className="text-xs text-destructive hover:underline disabled:opacity-50"
              title={`Delete ${branch.name}`}
            >
              Delete
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
