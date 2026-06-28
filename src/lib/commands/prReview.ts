import { z } from "zod";
import {
  invokeCommand,
  mentionCandidatesSchema,
  MentionCandidate,
  prFileDiffSchema,
  PrFileDiff,
} from "./runtime";

const prReviewerSchema = z.object({
  id: z.string().nullable(),
  displayName: z.string(),
  vote: z.number(),
  voteLabel: z.string(),
  isRequired: z.boolean(),
  isMe: z.boolean(),
});

export type PrReviewer = z.infer<typeof prReviewerSchema>;

const prCommentSchema = z.object({
  id: z.number(),
  parentCommentId: z.number().nullable(),
  content: z.string().nullable(),
  author: z.string().nullable(),
  publishedDate: z.string().nullable(),
  isSystem: z.boolean(),
  isMine: z.boolean(),
});

export type PrComment = z.infer<typeof prCommentSchema>;

const prThreadSchema = z.object({
  id: z.number(),
  status: z.string().nullable(),
  isResolved: z.boolean(),
  filePath: z.string().nullable(),
  rightLine: z.number().nullable(),
  leftLine: z.number().nullable().default(null),
  comments: z.array(prCommentSchema),
});

export type PrThread = z.infer<typeof prThreadSchema>;

const pullRequestReviewSchema = z.object({
  pullRequestId: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  sourceRefName: z.string(),
  targetRefName: z.string(),
  createdBy: z.string().nullable(),
  creationDate: z.string().nullable(),
  isDraft: z.boolean(),
  autoComplete: z.boolean().default(false),
  reviewers: z.array(prReviewerSchema),
  threads: z.array(prThreadSchema),
});

export type PullRequestReview = z.infer<typeof pullRequestReviewSchema>;

const prCommitSchema = z.object({
  commitId: z.string(),
  shortCommitId: z.string(),
  comment: z.string(),
  authorName: z.string().nullable(),
  authorDate: z.string().nullable(),
  webUrl: z.string().nullable(),
});

const prCommitsSchema = z.array(prCommitSchema);

export type PrCommit = z.infer<typeof prCommitSchema>;

const prChangedFileSchema = z.object({
  path: z.string(),
  changeType: z.string(),
  originalPath: z.string().nullable(),
});

export type PrChangedFile = z.infer<typeof prChangedFileSchema>;

const pullRequestChangesSchema = z.object({
  baseCommitId: z.string().nullable(),
  targetCommitId: z.string().nullable(),
  files: z.array(prChangedFileSchema),
});

export type PullRequestChanges = z.infer<typeof pullRequestChangesSchema>;

const prStatusResultSchema = z.object({
  status: z.string().nullable(),
  isDraft: z.boolean(),
});
export type PrStatusResult = z.infer<typeof prStatusResultSchema>;

export type PullRequestAction =
  | "abandon"
  | "reactivate"
  | "publish"
  | "complete"
  | "enableAutoComplete"
  | "cancelAutoComplete";

const prDetailsResultSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
});
export type PrDetailsResult = z.infer<typeof prDetailsResultSchema>;

export type PrLocatorInput = {
  organizationId?: string;
  projectId: string;
  repositoryId: string;
  pullRequestId: number;
};

/** Builds the PR locator shared by every PR review command. */
export function prLocator(pr: {
  organizationId: string;
  projectId: string;
  repositoryId: string;
  pullRequestId: number;
}): PrLocatorInput {
  return {
    organizationId: pr.organizationId,
    projectId: pr.projectId,
    repositoryId: pr.repositoryId,
    pullRequestId: pr.pullRequestId,
  };
}

export type GetPullRequestReviewInput = PrLocatorInput;
export type ListPullRequestChangesInput = PrLocatorInput;
export type ListPullRequestCommitsInput = PrLocatorInput;

export type GetPullRequestFileDiffInput = PrLocatorInput & {
  filePath: string;
  originalPath?: string | null;
  changeType: string;
  baseCommitId?: string | null;
  targetCommitId?: string | null;
};

export type PostPullRequestCommentInput = PrLocatorInput & {
  threadId?: number;
  content: string;
  filePath?: string;
  rightLine?: number;
  leftLine?: number;
};

export type SetPullRequestThreadStatusInput = PrLocatorInput & {
  threadId: number;
  status: "active" | "closed";
};

export type SubmitPullRequestVoteInput = PrLocatorInput & {
  vote: -10 | -5 | 0 | 5 | 10;
};

export type SearchPullRequestMentionsInput = {
  organizationId?: string;
  query: string;
};

export type EditPullRequestCommentInput = PrLocatorInput & {
  threadId: number;
  commentId: number;
  content: string;
};

export type DeletePullRequestCommentInput = PrLocatorInput & {
  threadId: number;
  commentId: number;
};

export async function getPullRequestReview(
  input: GetPullRequestReviewInput,
): Promise<PullRequestReview> {
  const result = await invokeCommand("get_pull_request_review", { input });
  return pullRequestReviewSchema.parse(result);
}

export async function listPullRequestChanges(
  input: ListPullRequestChangesInput,
): Promise<PullRequestChanges> {
  const result = await invokeCommand("list_pull_request_changes", { input });
  return pullRequestChangesSchema.parse(result);
}

export async function listPullRequestCommits(
  input: ListPullRequestCommitsInput,
): Promise<PrCommit[]> {
  const result = await invokeCommand("list_pull_request_commits", { input });
  return prCommitsSchema.parse(result);
}

export async function getPullRequestFileDiff(
  input: GetPullRequestFileDiffInput,
): Promise<PrFileDiff> {
  const result = await invokeCommand("get_pull_request_file_diff", { input });
  return prFileDiffSchema.parse(result);
}

export async function postPullRequestComment(
  input: PostPullRequestCommentInput,
): Promise<PrThread> {
  const result = await invokeCommand("post_pull_request_comment", { input });
  return prThreadSchema.parse(result);
}

export async function setPullRequestThreadStatus(
  input: SetPullRequestThreadStatusInput,
): Promise<PrThread> {
  const result = await invokeCommand("set_pull_request_thread_status", { input });
  return prThreadSchema.parse(result);
}

export async function submitPullRequestVote(
  input: SubmitPullRequestVoteInput,
): Promise<PrReviewer> {
  const result = await invokeCommand("submit_pull_request_vote", { input });
  return prReviewerSchema.parse(result);
}

export async function updatePullRequest(input: {
  organizationId?: string;
  projectId: string;
  repositoryId: string;
  pullRequestId: number;
  action: PullRequestAction;
  mergeStrategy?: string;
  deleteSourceBranch?: boolean;
  transitionWorkItems?: boolean;
}): Promise<PrStatusResult> {
  const result = await invokeCommand("update_pull_request", { input });
  return prStatusResultSchema.parse(result);
}

export async function setPullRequestReviewerRequired(input: {
  organizationId?: string;
  projectId: string;
  repositoryId: string;
  pullRequestId: number;
  reviewerId: string;
  isRequired: boolean;
}): Promise<void> {
  await invokeCommand("set_pull_request_reviewer_required", { input });
}

export async function removePullRequestReviewer(input: {
  organizationId?: string;
  projectId: string;
  repositoryId: string;
  pullRequestId: number;
  reviewerId: string;
}): Promise<void> {
  await invokeCommand("remove_pull_request_reviewer", { input });
}

export async function updatePullRequestDetails(input: {
  organizationId?: string;
  projectId: string;
  repositoryId: string;
  pullRequestId: number;
  title: string;
  description?: string;
}): Promise<PrDetailsResult> {
  const result = await invokeCommand("update_pull_request_details", { input });
  return prDetailsResultSchema.parse(result);
}

export async function searchPullRequestMentions(
  input: SearchPullRequestMentionsInput,
): Promise<MentionCandidate[]> {
  const result = await invokeCommand("search_pull_request_mentions", { input });
  return mentionCandidatesSchema.parse(result);
}

export async function editPullRequestComment(
  input: EditPullRequestCommentInput,
): Promise<PrThread> {
  const result = await invokeCommand("edit_pull_request_comment", { input });
  return prThreadSchema.parse(result);
}

export async function deletePullRequestComment(
  input: DeletePullRequestCommentInput,
): Promise<void> {
  await invokeCommand("delete_pull_request_comment", { input });
}
