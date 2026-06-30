import { z } from "zod";
import { invokeCommand } from "./runtime";

const codeSearchHitSchema = z.object({
  fileName: z.string(),
  path: z.string(),
  projectName: z.string(),
  repositoryName: z.string(),
  branch: z.string().nullable(),
  webUrl: z.string(),
});
const codeSearchResultsSchema = z.object({
  count: z.number(),
  results: z.array(codeSearchHitSchema),
  notice: z.string().nullable(),
});
export type CodeSearchHit = z.infer<typeof codeSearchHitSchema>;
export type CodeSearchResults = z.infer<typeof codeSearchResultsSchema>;

export async function searchCode(input: {
  organizationId?: string;
  query: string;
  /** Project names to include. Empty/omitted means all projects. */
  projects?: string[];
  /** Repository names to include. Empty/omitted means all repositories. */
  repositories?: string[];
  branch?: string;
  path?: string;
  /** Page size; the backend defaults this when omitted. */
  top?: number;
  /** Number of leading results to skip, for "load more" paging. */
  skip?: number;
  operationId?: string;
}): Promise<CodeSearchResults> {
  const result = await invokeCommand("search_code", { input });
  return codeSearchResultsSchema.parse(result);
}

const codeContextLineSchema = z.object({
  lineNumber: z.number(),
  text: z.string(),
  isMatch: z.boolean(),
});
const codeContextResultSchema = z.object({
  blocks: z.array(z.object({ lines: z.array(codeContextLineSchema) })),
  totalMatches: z.number(),
  truncated: z.boolean(),
});
export type CodeContextResult = z.infer<typeof codeContextResultSchema>;

export async function getCodeSearchContext(input: {
  organizationId?: string;
  project: string;
  repository: string;
  branch: string;
  path: string;
  query: string;
  contextLines?: number;
}): Promise<CodeContextResult> {
  const result = await invokeCommand("get_code_search_context", { input });
  return codeContextResultSchema.parse(result);
}

const repoBranchSchema = z.object({
  name: z.string(),
  isDefault: z.boolean(),
});
export type RepoBranch = z.infer<typeof repoBranchSchema>;

// Lists a repository's branches (default branch first).
export async function listRepoBranches(input: {
  organizationId?: string;
  project: string;
  repository: string;
}): Promise<RepoBranch[]> {
  const result = await invokeCommand("list_repo_branches", { input });
  return z.array(repoBranchSchema).parse(result);
}

const repoCommitInfoSchema = z.object({
  shortId: z.string(),
  commitId: z.string(),
  message: z.string(),
  author: z.string().nullable(),
  date: z.string().nullable(),
});
export type RepoCommitInfo = z.infer<typeof repoCommitInfoSchema>;

const repoTreeItemSchema = z.object({
  name: z.string(),
  path: z.string(),
  isFolder: z.boolean(),
  lastCommit: repoCommitInfoSchema.nullable(),
});
export type RepoTreeItem = z.infer<typeof repoTreeItemSchema>;

// Lists the direct children of a folder at the tip of a branch (folders first).
// Pass `includeLastCommit` for the folder table (each item's latest commit);
// the lightweight tree omits it.
export async function listRepoTree(input: {
  organizationId?: string;
  project: string;
  repository: string;
  branch: string;
  path?: string;
  includeLastCommit?: boolean;
  operationId?: string;
}): Promise<RepoTreeItem[]> {
  const result = await invokeCommand("list_repo_tree", { input });
  return z.array(repoTreeItemSchema).parse(result);
}

const repoFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  isBinary: z.boolean(),
  tooLarge: z.boolean(),
});
export type RepoFile = z.infer<typeof repoFileSchema>;

// Fetches a file's text content at the tip of a branch.
export async function getRepoFile(input: {
  organizationId?: string;
  project: string;
  repository: string;
  branch: string;
  path: string;
  operationId?: string;
}): Promise<RepoFile> {
  const result = await invokeCommand("get_repo_file", { input });
  return repoFileSchema.parse(result);
}

// Lists the commit history for a path at a branch (the Files > History tab).
export async function listRepoHistory(input: {
  organizationId?: string;
  project: string;
  repository: string;
  branch: string;
  path: string;
  /** Page size; the backend defaults this when omitted. */
  top?: number;
  /** Number of leading commits to skip, for "load more" paging. */
  skip?: number;
  operationId?: string;
}): Promise<RepoCommitInfo[]> {
  const result = await invokeCommand("list_repo_history", { input });
  return z.array(repoCommitInfoSchema).parse(result);
}

// Signals a cancellable command (e.g. code search) to stop, by the id passed as
// its operationId. Best-effort — the command returns promptly once cancelled.
export async function cancelOperation(operationId: string): Promise<void> {
  await invokeCommand("cancel_operation", { operationId });
}

// Generates a unique id for a cancellable operation.
export function newOperationId(): string {
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
