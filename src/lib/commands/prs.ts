import { z } from "zod";
import { invokeCommand } from "./runtime";

export const pullRequestSummarySchema = z.object({
  organizationId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  repositoryId: z.string(),
  repositoryName: z.string(),
  pullRequestId: z.number(),
  title: z.string(),
  status: z.string(),
  createdBy: z.string().nullable(),
  creationDate: z.string(),
  closedDate: z.string().nullable(),
  sourceRefName: z.string(),
  targetRefName: z.string(),
  webUrl: z.string().nullable(),
  isDraft: z.boolean(),
  // Label (tag) names on the pull request (issue #386).
  labels: z.array(z.string()).default([]),
});

export const pullRequestSummariesSchema = z.array(pullRequestSummarySchema);

const pullRequestSearchResultSchema = z.object({
  pullRequests: pullRequestSummariesSchema,
  total: z.number(),
  truncated: z.boolean(),
});

export type PullRequestSummary = z.infer<typeof pullRequestSummarySchema>;
export type PullRequestSearchResult = z.infer<typeof pullRequestSearchResultSchema>;

export const reviewPullRequestSummarySchema = z.object({
  organizationId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  repositoryId: z.string(),
  repositoryName: z.string(),
  pullRequestId: z.number(),
  title: z.string(),
  createdBy: z.string().nullable(),
  creationDate: z.string(),
  targetRefName: z.string(),
  webUrl: z.string().nullable(),
  myVote: z.number(),
  myVoteLabel: z.string(),
  myIsRequired: z.boolean(),
  isDraft: z.boolean(),
  mergeStatus: z.string().nullable().default(null),
  // Aggregate CI verdict: "succeeded" | "failed" | "in_progress" | "none".
  // null means CI was never fetched for this PR (treated as unknown/none).
  ciStatus: z.string().nullable().default(null),
  ciContext: z.string().nullable().default(null),
  ciCheckCount: z.number().default(0),
});

export const reviewPullRequestSummariesSchema = z.array(reviewPullRequestSummarySchema);

export const myCreatedPullRequestSummarySchema = z.object({
  organizationId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  repositoryId: z.string(),
  repositoryName: z.string(),
  pullRequestId: z.number(),
  title: z.string(),
  creationDate: z.string(),
  sourceRefName: z.string(),
  targetRefName: z.string(),
  webUrl: z.string().nullable(),
  isDraft: z.boolean(),
  // How many reviewers approved (vote === 10) out of the total assigned.
  approvals: z.number(),
  reviewerCount: z.number(),
});

export const myCreatedPullRequestSummariesSchema = z.array(myCreatedPullRequestSummarySchema);

export type MyCreatedPullRequestSummary = z.infer<typeof myCreatedPullRequestSummarySchema>;

export type ReviewPullRequestSummary = z.infer<typeof reviewPullRequestSummarySchema>;

export type SearchPullRequestsInput = {
  organizationId?: string;
  query?: string;
  /** Statuses to include. Empty/omitted defaults to active only. */
  statuses?: ("active" | "completed" | "abandoned")[];
  /** Projects to include. Empty/omitted means all projects. */
  projectIds?: string[];
  /** Repositories to include. Empty/omitted means all repositories. */
  repositoryIds?: string[];
  /** Branch name, e.g. "main" or "refs/heads/main". */
  targetBranch?: string;
  /** Inclusive date window as "YYYY-MM-DD". */
  fromDate?: string;
  toDate?: string;
  /** Which date the window applies to. Defaults to "created". */
  dateBasis?: "created" | "closed";
  excludeDrafts?: boolean;
  /** Result ordering. Defaults to "created". */
  sortBy?: "created" | "closed" | "title";
};

export type ListMyReviewPullRequestsInput = {
  organizationId?: string;
};

export type ListMyCreatedPullRequestsInput = {
  organizationId?: string;
};

export async function searchPullRequests(
  input: SearchPullRequestsInput,
): Promise<PullRequestSearchResult> {
  const result = await invokeCommand("search_pull_requests", { input });
  return pullRequestSearchResultSchema.parse(result);
}

const createPullRequestResultSchema = z.object({
  pullRequestId: z.number(),
  webUrl: z.string().nullable(),
});
export type CreatePullRequestResult = z.infer<typeof createPullRequestResultSchema>;

export type CreatePullRequestInput = {
  organizationId?: string;
  projectId: string;
  repositoryId: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description?: string;
};

export async function createPullRequest(
  input: CreatePullRequestInput,
): Promise<CreatePullRequestResult> {
  const result = await invokeCommand("create_pull_request", { input });
  return createPullRequestResultSchema.parse(result);
}

export async function listMyReviewPullRequests(
  input: ListMyReviewPullRequestsInput,
): Promise<ReviewPullRequestSummary[]> {
  const result = await invokeCommand("list_my_review_pull_requests", { input });
  return reviewPullRequestSummariesSchema.parse(result);
}

export async function listMyCreatedPullRequests(
  input: ListMyCreatedPullRequestsInput,
): Promise<MyCreatedPullRequestSummary[]> {
  const result = await invokeCommand("list_my_created_pull_requests", { input });
  return myCreatedPullRequestSummariesSchema.parse(result);
}
