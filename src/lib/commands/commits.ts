import { z } from "zod";
import { invokeCommand, prFileDiffSchema } from "./runtime";

const commitSummarySchema = z.object({
  organizationId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  repositoryId: z.string(),
  repositoryName: z.string(),
  commitId: z.string(),
  shortCommitId: z.string(),
  comment: z.string(),
  authorName: z.string().nullable(),
  authorEmail: z.string().nullable(),
  authorDate: z.string().nullable(),
  webUrl: z.string().nullable(),
});

export const commitSummariesSchema = z.array(commitSummarySchema);

const commitSearchResultSchema = z.object({
  commits: commitSummariesSchema,
  total: z.number(),
  truncated: z.boolean(),
});

export type CommitSummary = z.infer<typeof commitSummarySchema>;
export type CommitSearchResult = z.infer<typeof commitSearchResultSchema>;

const commitRepositoryOptionSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  repositoryId: z.string(),
  repositoryName: z.string(),
});

const commitRepositoryOptionsSchema = z.array(commitRepositoryOptionSchema);

export type CommitRepositoryOption = z.infer<typeof commitRepositoryOptionSchema>;

const commitActivityDaySchema = z.object({
  date: z.string(),
  count: z.number(),
});

const commitActivityDaysSchema = z.array(commitActivityDaySchema);

export type CommitActivityDay = z.infer<typeof commitActivityDaySchema>;

const commitChangedFileSchema = z.object({
  path: z.string(),
  changeType: z.string(),
  originalPath: z.string().nullable(),
});
const commitChangeSetSchema = z.object({
  commitId: z.string(),
  parentCommitId: z.string().nullable(),
  files: z.array(commitChangedFileSchema),
});
export type CommitChangedFile = z.infer<typeof commitChangedFileSchema>;
export type CommitChangeSet = z.infer<typeof commitChangeSetSchema>;
// A commit's per-file diff has the same shape as a PR file diff.
export type CommitFileDiff = z.infer<typeof prFileDiffSchema>;

const commitPullRequestSchema = z.object({
  pullRequestId: z.number(),
  repositoryId: z.string(),
  title: z.string(),
  status: z.string(),
  myVote: z.number(),
  myVoteLabel: z.string(),
  webUrl: z.string().nullable(),
});
const commitPullRequestsSchema = z.array(commitPullRequestSchema);
export type CommitPullRequest = z.infer<typeof commitPullRequestSchema>;

export type SearchCommitsInput = {
  organizationId?: string;
  query?: string;
  author?: string;
  branch?: string;
  /** Server-relative path (e.g. src/auth) parsed from a `path:` token. */
  itemPath?: string;
  fromDate?: string;
  toDate?: string;
  /** Projects to include. Empty/omitted means all projects. */
  projectIds?: string[];
  /** Repositories to include. Empty/omitted means all repositories. */
  repositoryIds?: string[];
};

export type ListCommitRepositoriesInput = {
  organizationId?: string;
};

export type CommitActivityInput = {
  organizationId?: string;
  author?: string;
  fromDate?: string;
  toDate?: string;
  projectId?: string;
  repositoryId?: string;
};

export async function getCommitChanges(input: {
  organizationId?: string;
  projectId: string;
  repositoryId: string;
  commitId: string;
}): Promise<CommitChangeSet> {
  const result = await invokeCommand("get_commit_changes", { input });
  return commitChangeSetSchema.parse(result);
}

export async function getCommitFileDiff(input: {
  organizationId?: string;
  projectId: string;
  repositoryId: string;
  filePath: string;
  originalPath?: string | null;
  changeType: string;
  commitId: string;
  parentCommitId?: string | null;
}): Promise<CommitFileDiff> {
  const result = await invokeCommand("get_commit_file_diff", { input });
  return prFileDiffSchema.parse(result);
}

export async function getCommitPullRequests(input: {
  organizationId?: string;
  repositoryId: string;
  commitId: string;
}): Promise<CommitPullRequest[]> {
  const result = await invokeCommand("get_commit_pull_requests", { input });
  return commitPullRequestsSchema.parse(result);
}

export async function searchCommits(
  input: SearchCommitsInput,
): Promise<CommitSearchResult> {
  const result = await invokeCommand("search_commits", { input });
  return commitSearchResultSchema.parse(result);
}

export async function listCommitRepositories(
  input: ListCommitRepositoriesInput,
): Promise<CommitRepositoryOption[]> {
  const result = await invokeCommand("list_commit_repositories", { input });
  return commitRepositoryOptionsSchema.parse(result);
}

export async function commitActivity(
  input: CommitActivityInput,
): Promise<CommitActivityDay[]> {
  const result = await invokeCommand("commit_activity", { input });
  return commitActivityDaysSchema.parse(result);
}

const commitRefOperationResultSchema = z.object({
  status: z.string(),
  newBranchName: z.string(),
  newBranchWebUrl: z.string().nullable(),
  conflict: z.boolean(),
  failureMessage: z.string().nullable(),
});

export type CommitRefOperationResult = z.infer<typeof commitRefOperationResultSchema>;

export type CommitRefOperationInput = {
  organizationId?: string;
  projectId: string;
  projectName: string;
  repositoryId: string;
  repositoryName: string;
  commitId: string;
  ontoBranch: string;
  newBranchName: string;
};

export async function cherryPickCommit(
  input: CommitRefOperationInput,
): Promise<CommitRefOperationResult> {
  const result = await invokeCommand("cherry_pick_commit", { input });
  return commitRefOperationResultSchema.parse(result);
}

export async function revertCommit(
  input: CommitRefOperationInput,
): Promise<CommitRefOperationResult> {
  const result = await invokeCommand("revert_commit", { input });
  return commitRefOperationResultSchema.parse(result);
}
