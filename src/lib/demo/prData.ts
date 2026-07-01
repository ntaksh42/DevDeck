import type {
  MyCreatedPullRequestSummary,
  PullRequestReview,
  PullRequestSearchResult,
  PullRequestSummary,
  ReviewPullRequestSummary,
  SearchPullRequestsInput,
} from "@/lib/azdoCommands";
import {
  applyPullRequestScenario,
  applyReviewPullRequestScenario,
} from "@/lib/azdoDemoHarness";
import { demoThreadsFor, demoVoteLabel } from "@/lib/demo/prReview";

// In-memory vote store for browser demo mode. Votes cast via
// submit_pull_request_vote persist for the session.
const demoPrVotes = new Map<number, number>();

export function setDemoPrVote(pullRequestId: number, vote: number): void {
  demoPrVotes.set(pullRequestId, vote);
}

export function demoPullRequests(input?: SearchPullRequestsInput): PullRequestSearchResult {
  const now = new Date("2026-05-27T08:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const hr = 3_600_000;
  const day = 86_400_000;

  const all: PullRequestSummary[] = [
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "azdo-dashboard",
      repositoryName: "azdo-dashboard",
      pullRequestId: 42,
      title: "Add pull request search dashboard",
      status: "active",
      createdBy: "Demo User",
      creationDate: ago(2 * hr),
      sourceRefName: "feature/pr-search",
      targetRefName: "main",
      closedDate: null,
      isDraft: false,
      webUrl: "https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/pullrequest/42",
      labels: ["needs-review"],
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "api-gateway",
      repositoryName: "api-gateway",
      pullRequestId: 103,
      title: "Refactor authentication flow with OAuth 2.0 PKCE",
      status: "active",
      createdBy: "Dave Kim",
      creationDate: ago(1 * day),
      sourceRefName: "feature/oauth-pkce",
      targetRefName: "main",
      closedDate: null,
      isDraft: false,
      webUrl: "https://dev.azure.com/contoso/Platform/_git/api-gateway/pullrequest/103",
      labels: ["hotfix", "security"],
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "api-gateway",
      repositoryName: "api-gateway",
      pullRequestId: 99,
      title: "Add OpenTelemetry tracing support",
      status: "completed",
      createdBy: "Grace Chen",
      creationDate: ago(5 * day),
      sourceRefName: "feature/otel-tracing",
      targetRefName: "main",
      closedDate: ago(3 * day),
      isDraft: false,
      webUrl: "https://dev.azure.com/contoso/Platform/_git/api-gateway/pullrequest/99",
      labels: [],
    },
    {
      organizationId: "contoso",
      projectId: "mobile",
      projectName: "Mobile",
      repositoryId: "android-app",
      repositoryName: "android-app",
      pullRequestId: 189,
      title: "Fix crash on back press during payment flow",
      status: "active",
      createdBy: "Frank Lee",
      creationDate: ago(3 * hr),
      sourceRefName: "fix/payment-back-crash",
      targetRefName: "main",
      closedDate: null,
      isDraft: false,
      webUrl: "https://dev.azure.com/contoso/Mobile/_git/android-app/pullrequest/189",
      labels: ["hotfix"],
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "azdo-dashboard",
      repositoryName: "azdo-dashboard",
      pullRequestId: 88,
      title: "Prototype offline-first sync engine",
      status: "abandoned",
      createdBy: "Heidi Park",
      creationDate: ago(12 * day),
      sourceRefName: "spike/offline-sync",
      targetRefName: "main",
      closedDate: ago(9 * day),
      isDraft: false,
      webUrl: "https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/pullrequest/88",
      labels: [],
    },
    {
      organizationId: "contoso",
      projectId: "mobile",
      projectName: "Mobile",
      repositoryId: "android-app",
      repositoryName: "android-app",
      pullRequestId: 180,
      title: "Add biometric auth for payment screen",
      status: "active",
      createdBy: "Carol Wang",
      creationDate: ago(2 * day),
      sourceRefName: "feature/biometric-auth",
      targetRefName: "develop",
      closedDate: null,
      isDraft: true,
      webUrl: "https://dev.azure.com/contoso/Mobile/_git/android-app/pullrequest/180",
      labels: ["needs-review"],
    },
    {
      organizationId: "contoso",
      projectId: "infrastructure",
      projectName: "Infrastructure",
      repositoryId: "terraform-aws",
      repositoryName: "terraform-aws",
      pullRequestId: 55,
      title: "Upgrade EKS cluster to 1.29",
      status: "active",
      createdBy: "Eve Nakamura",
      creationDate: ago(8 * day),
      sourceRefName: "infra/eks-1.29",
      targetRefName: "main",
      closedDate: null,
      isDraft: false,
      webUrl: "https://dev.azure.com/contoso/Infrastructure/_git/terraform-aws/pullrequest/55",
      labels: [],
    },
  ];

  const query = input?.query?.trim().toLowerCase();
  // Empty/omitted statuses default to active, mirroring the backend.
  const statusFilter = new Set(
    input?.statuses && input.statuses.length > 0 ? input.statuses : ["active"],
  );
  const projectFilter = new Set((input?.projectIds ?? []).filter(Boolean));
  const repositoryFilter = new Set((input?.repositoryIds ?? []).filter(Boolean));
  const targetBranch = input?.targetBranch
    ?.trim()
    .replace(/^refs\/heads\//, "")
    .toLowerCase();
  const fromDate = input?.fromDate?.trim() || undefined;
  const toDate = input?.toDate?.trim() || undefined;
  // The close-date basis only applies when no active rows are in scope, since
  // active PRs have no close date — mirroring the backend's cache path.
  const useClosedBasis = !statusFilter.has("active") && input?.dateBasis === "closed";
  const excludeDrafts = input?.excludeDrafts ?? false;
  const sortBy = input?.sortBy ?? "created";

  const inWindow = (iso: string | null) => {
    if (!fromDate && !toDate) return true;
    if (!iso) return false;
    const d = iso.slice(0, 10);
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  };

  const matched = applyPullRequestScenario(all).filter((pr) => {
    if (projectFilter.size > 0 && !projectFilter.has(pr.projectId)) return false;
    if (repositoryFilter.size > 0 && !repositoryFilter.has(pr.repositoryId)) return false;
    if (!statusFilter.has(pr.status)) return false;
    if (targetBranch && pr.targetRefName.toLowerCase() !== targetBranch) return false;
    if (!inWindow(useClosedBasis ? pr.closedDate : pr.creationDate)) return false;
    if (excludeDrafts && pr.isDraft) return false;
    if (query) {
      const textMatch = [pr.title, pr.projectName, pr.repositoryName, pr.createdBy ?? "", pr.sourceRefName, pr.targetRefName].some(
        (v) => v.toLowerCase().includes(query),
      );
      const idMatch = /^\d+$/.test(query) && String(pr.pullRequestId).startsWith(query);
      if (!textMatch && !idMatch) return false;
    }
    return true;
  });

  const sorted = matched.slice().sort((a, b) => {
    if (sortBy === "title") {
      return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
    }
    if (sortBy === "closed") {
      const cmp = (b.closedDate ?? "").localeCompare(a.closedDate ?? "");
      return cmp !== 0 ? cmp : b.creationDate.localeCompare(a.creationDate);
    }
    return b.creationDate.localeCompare(a.creationDate);
  });

  const limit = 100;
  return {
    pullRequests: sorted.slice(0, limit),
    total: sorted.length,
    truncated: sorted.length > limit,
  };
}

export function demoMyCreatedPullRequests(): MyCreatedPullRequestSummary[] {
  const now = new Date("2026-05-24T08:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const day = 86_400_000;
  return [
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "api-gateway",
      repositoryName: "api-gateway",
      pullRequestId: 210,
      title: "Add request tracing to the gateway",
      creationDate: ago(1 * day),
      sourceRefName: "feature/gateway-tracing",
      targetRefName: "main",
      webUrl: "https://dev.azure.com/contoso/Platform/_git/api-gateway/pullrequest/210",
      isDraft: false,
      approvals: 1,
      reviewerCount: 2,
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "auth-service",
      repositoryName: "auth-service",
      pullRequestId: 205,
      title: "Refactor session store for clustering",
      creationDate: ago(4 * day),
      sourceRefName: "feature/session-cluster",
      targetRefName: "main",
      webUrl: "https://dev.azure.com/contoso/Platform/_git/auth-service/pullrequest/205",
      isDraft: true,
      approvals: 0,
      reviewerCount: 1,
    },
  ];
}

export function demoReviewPullRequests(): ReviewPullRequestSummary[] {
  const now = new Date("2026-05-24T08:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const min = 60_000;
  const hr = 3_600_000;
  const day = 86_400_000;

  return withDemoVotes(applyReviewPullRequestScenario([
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "api-gateway",
      repositoryName: "api-gateway",
      pullRequestId: 101,
      title: "Add rate limiting middleware to all endpoints",
      createdBy: "Alice Johnson",
      creationDate: ago(2 * day),
      targetRefName: "main",
      webUrl: "https://dev.azure.com/contoso/Platform/_git/api-gateway/pullrequest/101",
      myVote: 0,
      myVoteLabel: "No Vote",
      myIsRequired: true,
      isDraft: false,
      mergeStatus: "conflicts",
      ciStatus: "failed",
      ciContext: "ci-build",
      ciCheckCount: 3,
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "auth-service",
      repositoryName: "auth-service",
      pullRequestId: 98,
      title: "Migrate token signing to RS256",
      createdBy: "Bob Tanaka",
      creationDate: ago(5 * day),
      targetRefName: "main",
      webUrl: "https://dev.azure.com/contoso/Platform/_git/auth-service/pullrequest/98",
      myVote: 0,
      myVoteLabel: "No Vote",
      myIsRequired: true,
      isDraft: false,
      mergeStatus: null,
      ciStatus: "succeeded",
      ciContext: "ci-build",
      ciCheckCount: 2,
    },
    {
      organizationId: "contoso",
      projectId: "mobile",
      projectName: "Mobile",
      repositoryId: "ios-app",
      repositoryName: "ios-app",
      pullRequestId: 214,
      title: "Dark mode support for settings screen",
      createdBy: "Carol Wang",
      creationDate: ago(1 * day),
      targetRefName: "develop",
      webUrl: "https://dev.azure.com/contoso/Mobile/_git/ios-app/pullrequest/214",
      myVote: 5,
      myVoteLabel: "Approved w/ Suggestions",
      myIsRequired: false,
      isDraft: false,
      mergeStatus: null,
      ciStatus: "in_progress",
      ciContext: "ios-build",
      ciCheckCount: 1,
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "api-gateway",
      repositoryName: "api-gateway",
      pullRequestId: 103,
      title: "Refactor authentication flow with OAuth 2.0 PKCE",
      createdBy: "Dave Kim",
      creationDate: ago(30 * min),
      targetRefName: "main",
      webUrl: "https://dev.azure.com/contoso/Platform/_git/api-gateway/pullrequest/103",
      myVote: 0,
      myVoteLabel: "No Vote",
      myIsRequired: false,
      isDraft: true,
      mergeStatus: null,
      ciStatus: null,
      ciContext: null,
      ciCheckCount: 0,
    },
    {
      organizationId: "contoso",
      projectId: "infrastructure",
      projectName: "Infrastructure",
      repositoryId: "terraform-aws",
      repositoryName: "terraform-aws",
      pullRequestId: 55,
      title: "Upgrade EKS cluster to 1.29",
      createdBy: "Eve Nakamura",
      creationDate: ago(8 * day),
      targetRefName: "main",
      webUrl: "https://dev.azure.com/contoso/Infrastructure/_git/terraform-aws/pullrequest/55",
      myVote: -10,
      myVoteLabel: "Rejected",
      myIsRequired: true,
      isDraft: false,
      mergeStatus: null,
      ciStatus: "failed",
      ciContext: "terraform-validate",
      ciCheckCount: 2,
    },
    {
      organizationId: "contoso",
      projectId: "mobile",
      projectName: "Mobile",
      repositoryId: "android-app",
      repositoryName: "android-app",
      pullRequestId: 189,
      title: "Fix crash on back press during payment flow",
      createdBy: "Frank Lee",
      creationDate: ago(3 * hr),
      targetRefName: "main",
      webUrl: "https://dev.azure.com/contoso/Mobile/_git/android-app/pullrequest/189",
      myVote: -5,
      myVoteLabel: "Waiting",
      myIsRequired: false,
      isDraft: false,
      mergeStatus: null,
      ciStatus: null,
      ciContext: null,
      ciCheckCount: 0,
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "api-gateway",
      repositoryName: "api-gateway",
      pullRequestId: 99,
      title: "Add OpenTelemetry tracing support",
      createdBy: "Grace Chen",
      creationDate: ago(12 * day),
      targetRefName: "main",
      webUrl: "https://dev.azure.com/contoso/Platform/_git/api-gateway/pullrequest/99",
      myVote: 10,
      myVoteLabel: "Approved",
      myIsRequired: false,
      isDraft: false,
      mergeStatus: null,
      ciStatus: "succeeded",
      ciContext: "ci-build",
      ciCheckCount: 4,
    },
  ]));
}

// Reflects votes cast through submit_pull_request_vote in the demo session.
function withDemoVotes(prs: ReviewPullRequestSummary[]): ReviewPullRequestSummary[] {
  if (demoPrVotes.size === 0) return prs;
  return prs.map((pr) => {
    const vote = demoPrVotes.get(pr.pullRequestId);
    if (vote == null) return pr;
    return { ...pr, myVote: vote, myVoteLabel: demoVoteLabel(vote) };
  });
}

export function demoPrReviewDetail(prId: number): PullRequestReview {
  const summary = demoReviewPullRequests().find((pr) => pr.pullRequestId === prId);
  const myVote = demoPrVotes.get(prId) ?? summary?.myVote ?? 0;
  return {
    pullRequestId: prId,
    title: summary?.title ?? `Demo pull request #${prId}`,
    description:
      "## Summary\nImproves the dashboard loading flow. Implements AB#123 and partially addresses AB#187.\n\n- configurable refresh interval\n- removes the legacy loader",
    // Backend strips refs/heads/ in get_review; mirror that here.
    sourceRefName: "feature/dashboard-loading",
    targetRefName: summary?.targetRefName ?? "main",
    createdBy: summary?.createdBy ?? "Avery Author",
    creationDate: summary?.creationDate ?? "2026-05-20T08:00:00Z",
    isDraft: summary?.isDraft ?? false,
    autoComplete: false,
    reviewers: [
      {
        id: "demo-user",
        displayName: "Demo User",
        vote: myVote,
        voteLabel: demoVoteLabel(myVote),
        isRequired: summary?.myIsRequired ?? true,
        isMe: true,
      },
      {
        id: "riley-reviewer",
        displayName: "Riley Reviewer",
        vote: 10,
        voteLabel: "Approved",
        isRequired: false,
        isMe: false,
      },
    ],
    labels: [
      { id: "demo-label-1", name: "hotfix" },
      { id: "demo-label-2", name: "needs-docs" },
    ],
    threads: demoThreadsFor(prId),
  };
}
