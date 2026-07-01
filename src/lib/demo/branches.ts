// Demo data for the repository branches panel (issue #398), split into its
// own file since demo/commits.ts is already close to the 500-line cap.
import type { BranchSummary } from "@/lib/azdoCommands";
import { demoPullRequests } from "@/lib/demo/prData";

export function demoBranchSummaries(repositoryId?: string): BranchSummary[] {
  const repo = repositoryId ?? "azdo-dashboard";
  const now = new Date("2026-05-27T08:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const hr = 3_600_000;
  const day = 86_400_000;

  // Link branches to the active PR that uses them as a source branch.
  const activePrs = demoPullRequests({ statuses: ["active"] }).pullRequests.filter(
    (pr) => pr.repositoryId === repo,
  );
  const prForBranch = (branch: string) => activePrs.find((pr) => pr.sourceRefName === branch);

  const rawBranches: Array<{
    name: string;
    isBaseVersion: boolean;
    aheadCount: number;
    behindCount: number;
    lastUpdated: string;
    lastAuthor: string;
    lastCommitComment: string;
  }> = [
    {
      name: "main",
      isBaseVersion: true,
      aheadCount: 0,
      behindCount: 0,
      lastUpdated: ago(2 * hr),
      lastAuthor: "Demo User",
      lastCommitComment: "Merge pull request #41",
    },
    {
      name: "feature/pr-search",
      isBaseVersion: false,
      aheadCount: 6,
      behindCount: 1,
      lastUpdated: ago(2 * hr),
      lastAuthor: "Demo User",
      lastCommitComment: "Add pull request search dashboard",
    },
    {
      name: "fix/payment-back-crash",
      isBaseVersion: false,
      aheadCount: 2,
      behindCount: 4,
      lastUpdated: ago(3 * hr),
      lastAuthor: "Frank Lee",
      lastCommitComment: "Guard against null payment session",
    },
    {
      name: "chore/dependency-bump",
      isBaseVersion: false,
      aheadCount: 1,
      behindCount: 12,
      lastUpdated: ago(9 * day),
      lastAuthor: "Grace Chen",
      lastCommitComment: "Bump dependencies to latest patch",
    },
  ];

  return rawBranches.map((branch, index) => {
    const pr = branch.isBaseVersion ? undefined : prForBranch(branch.name);
    return {
      name: branch.name,
      isBaseVersion: branch.isBaseVersion,
      aheadCount: branch.aheadCount,
      behindCount: branch.behindCount,
      lastCommitId: `demo-commit-${repo}-${index}`,
      lastCommitComment: branch.lastCommitComment,
      lastUpdated: branch.lastUpdated,
      lastAuthor: branch.lastAuthor,
      pullRequestId: pr?.pullRequestId ?? null,
      pullRequestTitle: pr?.title ?? null,
      pullRequestUrl: pr?.webUrl ?? null,
    };
  });
}
