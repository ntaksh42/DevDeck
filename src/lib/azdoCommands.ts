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

const workItemSummarySchema = z.object({
  organizationId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  id: z.number(),
  title: z.string(),
  workItemType: z.string().nullable(),
  state: z.string().nullable(),
  assignedTo: z.string().nullable(),
  changedDate: z.string().nullable(),
  webUrl: z.string().nullable(),
});

const workItemSummariesSchema = z.array(workItemSummarySchema);

export type WorkItemSummary = z.infer<typeof workItemSummarySchema>;

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

const commitSummariesSchema = z.array(commitSummarySchema);

export type CommitSummary = z.infer<typeof commitSummarySchema>;

export type AddPatOrganizationInput = {
  organization: string;
  pat: string;
};

export type SearchPullRequestsInput = {
  organizationId?: string;
  query?: string;
  status?: "active" | "completed" | "abandoned" | "all";
};

export type SearchWorkItemsInput = {
  organizationId?: string;
  query?: string;
  state?: string;
  workItemType?: string;
};

export type SearchCommitsInput = {
  organizationId?: string;
  query?: string;
  author?: string;
  branch?: string;
  fromDate?: string;
  toDate?: string;
};

export async function listOrganizations(): Promise<Organization[]> {
  const result = await invokeCommand("list_organizations");
  return organizationsSchema.parse(result);
}

export async function addPatOrganization(
  input: AddPatOrganizationInput,
): Promise<Organization> {
  const result = await invokeCommand("add_pat_organization", { input });
  return organizationSchema.parse(result);
}

export async function searchPullRequests(
  input: SearchPullRequestsInput,
): Promise<PullRequestSummary[]> {
  const result = await invokeCommand("search_pull_requests", { input });
  return pullRequestSummariesSchema.parse(result);
}

export async function searchWorkItems(
  input: SearchWorkItemsInput,
): Promise<WorkItemSummary[]> {
  const result = await invokeCommand("search_work_items", { input });
  return workItemSummariesSchema.parse(result);
}

export async function searchCommits(
  input: SearchCommitsInput,
): Promise<CommitSummary[]> {
  const result = await invokeCommand("search_commits", { input });
  return commitSummariesSchema.parse(result);
}

async function invokeCommand(command: string, args?: unknown): Promise<unknown> {
  if (isTauriRuntime()) {
    return invoke(command, args as Record<string, unknown> | undefined);
  }

  return demoInvoke(command, args);
}

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window &&
    typeof (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__ === "object"
  );
}

const demoOrganization: Organization = {
  id: "contoso",
  name: "contoso",
  displayName: "Contoso",
  baseUrl: "https://dev.azure.com/contoso",
  authProvider: "pat",
  credentialKey: "azdodeck:org:contoso:pat",
  authenticatedUserId: "demo-user",
  authenticatedUserDisplayName: "Demo User",
  createdAt: "2026-05-24T00:00:00Z",
  updatedAt: "2026-05-24T00:00:00Z",
};

async function demoInvoke(command: string, args?: unknown): Promise<unknown> {
  await new Promise((resolve) => window.setTimeout(resolve, 100));

  switch (command) {
    case "list_organizations":
      return [demoOrganization];
    case "add_pat_organization": {
      const input = (args as { input?: AddPatOrganizationInput } | undefined)
        ?.input;
      return {
        ...demoOrganization,
        id: input?.organization || demoOrganization.id,
        name: input?.organization || demoOrganization.name,
        baseUrl: `https://dev.azure.com/${input?.organization || demoOrganization.name}`,
      };
    }
    case "search_pull_requests":
      return demoPullRequests();
    case "search_work_items":
      return demoWorkItems();
    case "search_commits":
      return demoCommits();
    default:
      throw new Error(`Unsupported demo command: ${command}`);
  }
}

function demoPullRequests(): PullRequestSummary[] {
  return [
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
      creationDate: "2026-05-24T00:00:00Z",
      sourceRefName: "feature/pr-search",
      targetRefName: "main",
      webUrl:
        "https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/pullrequest/42",
    },
  ];
}

function demoWorkItems(): WorkItemSummary[] {
  return [
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      id: 123,
      title: "Validate onboarding with PAT credentials",
      workItemType: "Task",
      state: "Active",
      assignedTo: "Demo User",
      changedDate: "2026-05-24T00:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/123",
    },
  ];
}

function demoCommits(): CommitSummary[] {
  return [
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "azdo-dashboard",
      repositoryName: "azdo-dashboard",
      commitId: "abcdef1234567890abcdef1234567890abcdef12",
      shortCommitId: "abcdef12",
      comment: "Add commit search dashboard",
      authorName: "Demo User",
      authorEmail: "demo@example.com",
      authorDate: "2026-05-24T00:00:00Z",
      webUrl:
        "https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/commit/abcdef1234567890abcdef1234567890abcdef12",
    },
  ];
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
