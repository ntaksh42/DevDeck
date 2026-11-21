import { z } from "zod";
import { invokeCommand } from "./runtime";

const repositoryOptionSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  repositoryId: z.string(),
  repositoryName: z.string(),
});

export type RepositoryOption = z.infer<typeof repositoryOptionSchema>;

// Lists the organization's repositories across all projects, sorted by
// project then repository name.
export async function listRepositories(input: {
  organizationId?: string;
}): Promise<RepositoryOption[]> {
  const result = await invokeCommand("list_repositories", { input });
  return z.array(repositoryOptionSchema).parse(result);
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
