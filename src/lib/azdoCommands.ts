import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string().nullable(),
  baseUrl: z.string(),
  authProvider: z.string(),
  credentialKey: z.string(),
  authenticatedUserId: z.string().nullable(),
  authenticatedUserDisplayName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const organizationsSchema = z.array(organizationSchema);

export type Organization = z.infer<typeof organizationSchema>;

const pullRequestSummarySchema = z.object({
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
  sourceRefName: z.string(),
  targetRefName: z.string(),
  webUrl: z.string().nullable(),
});

const pullRequestSummariesSchema = z.array(pullRequestSummarySchema);

export type PullRequestSummary = z.infer<typeof pullRequestSummarySchema>;

export type AddPatOrganizationInput = {
  organization: string;
  pat: string;
};

export type SearchPullRequestsInput = {
  organizationId?: string;
  query?: string;
  status?: "active" | "completed" | "abandoned" | "all";
};

export async function listOrganizations(): Promise<Organization[]> {
  const result = await invoke("list_organizations");
  return organizationsSchema.parse(result);
}

export async function addPatOrganization(
  input: AddPatOrganizationInput,
): Promise<Organization> {
  const result = await invoke("add_pat_organization", { input });
  return organizationSchema.parse(result);
}

export async function searchPullRequests(
  input: SearchPullRequestsInput,
): Promise<PullRequestSummary[]> {
  const result = await invoke("search_pull_requests", { input });
  return pullRequestSummariesSchema.parse(result);
}

export function commandErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Unexpected error";
}
