import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { isTauriRuntime } from "@/lib/runtime";

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

const appSettingsSchema = z.object({
  reviewResultFolderPath: z.string().nullable(),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

const reviewResultPreviewSchema = z.object({
  pullRequestId: z.number(),
  fileName: z.string(),
  filePath: z.string(),
  html: z.string(),
});

export type ReviewResultPreview = z.infer<typeof reviewResultPreviewSchema>;

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

const reviewPullRequestSummarySchema = z.object({
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
});

const reviewPullRequestSummariesSchema = z.array(reviewPullRequestSummarySchema);

export type ReviewPullRequestSummary = z.infer<typeof reviewPullRequestSummarySchema>;

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

const commitRepositoryOptionSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  repositoryId: z.string(),
  repositoryName: z.string(),
});

const commitRepositoryOptionsSchema = z.array(commitRepositoryOptionSchema);

export type CommitRepositoryOption = z.infer<typeof commitRepositoryOptionSchema>;

export type AddPatOrganizationInput = {
  organization: string;
  pat: string;
};

export type AddAzureCliOrganizationInput = {
  organization: string;
};

export type UpdateAppSettingsInput = {
  reviewResultFolderPath?: string | null;
};

export type GetReviewResultPreviewInput = {
  pullRequestId: number;
};

export type SearchPullRequestsInput = {
  organizationId?: string;
  query?: string;
  status?: "active" | "completed" | "abandoned" | "all";
};

export type ListMyReviewPullRequestsInput = {
  organizationId?: string;
};

export type SearchWorkItemsInput = {
  organizationId?: string;
  query?: string;
  state?: string;
  workItemType?: string;
};

export type ListMyWorkItemsInput = {
  organizationId?: string;
};

export type SearchCommitsInput = {
  organizationId?: string;
  query?: string;
  author?: string;
  branch?: string;
  fromDate?: string;
  toDate?: string;
  projectId?: string;
  repositoryId?: string;
};

export type ListCommitRepositoriesInput = {
  organizationId?: string;
};

export async function listOrganizations(): Promise<Organization[]> {
  const result = await invokeCommand("list_organizations");
  return organizationsSchema.parse(result);
}

export async function getAppSettings(): Promise<AppSettings> {
  const result = await invokeCommand("get_app_settings");
  return appSettingsSchema.parse(result);
}

export async function updateAppSettings(
  input: UpdateAppSettingsInput,
): Promise<AppSettings> {
  const result = await invokeCommand("update_app_settings", { input });
  return appSettingsSchema.parse(result);
}

export async function getReviewResultPreview(
  input: GetReviewResultPreviewInput,
): Promise<ReviewResultPreview | null> {
  const result = await invokeCommand("get_review_result_preview", { input });
  return reviewResultPreviewSchema.nullable().parse(result);
}

export async function addPatOrganization(
  input: AddPatOrganizationInput,
): Promise<Organization> {
  const result = await invokeCommand("add_pat_organization", { input });
  return organizationSchema.parse(result);
}

export async function addAzureCliOrganization(
  input: AddAzureCliOrganizationInput,
): Promise<Organization> {
  const result = await invokeCommand("add_azure_cli_organization", { input });
  return organizationSchema.parse(result);
}

export async function searchPullRequests(
  input: SearchPullRequestsInput,
): Promise<PullRequestSummary[]> {
  const result = await invokeCommand("search_pull_requests", { input });
  return pullRequestSummariesSchema.parse(result);
}

export async function listMyReviewPullRequests(
  input: ListMyReviewPullRequestsInput,
): Promise<ReviewPullRequestSummary[]> {
  const result = await invokeCommand("list_my_review_pull_requests", { input });
  return reviewPullRequestSummariesSchema.parse(result);
}

export async function searchWorkItems(
  input: SearchWorkItemsInput,
): Promise<WorkItemSummary[]> {
  const result = await invokeCommand("search_work_items", { input });
  return workItemSummariesSchema.parse(result);
}

export async function listMyWorkItems(
  input: ListMyWorkItemsInput,
): Promise<WorkItemSummary[]> {
  const result = await invokeCommand("list_my_work_items", { input });
  return workItemSummariesSchema.parse(result);
}

export async function searchCommits(
  input: SearchCommitsInput,
): Promise<CommitSummary[]> {
  const result = await invokeCommand("search_commits", { input });
  return commitSummariesSchema.parse(result);
}

export async function listCommitRepositories(
  input: ListCommitRepositoriesInput,
): Promise<CommitRepositoryOption[]> {
  const result = await invokeCommand("list_commit_repositories", { input });
  return commitRepositoryOptionsSchema.parse(result);
}

async function invokeCommand(command: string, args?: unknown): Promise<unknown> {
  if (isTauriRuntime()) {
    return invoke(command, args as Record<string, unknown> | undefined);
  }

  return demoInvoke(command, args);
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

let demoSettings: AppSettings = {
  reviewResultFolderPath: "C:\\reports\\azdo-reviews",
};

async function demoInvoke(command: string, args?: unknown): Promise<unknown> {
  await new Promise((resolve) => window.setTimeout(resolve, 100));

  switch (command) {
    case "list_organizations":
      return [demoOrganization];
    case "get_app_settings":
      return demoSettings;
    case "update_app_settings": {
      const input = (args as { input?: UpdateAppSettingsInput } | undefined)
        ?.input;
      demoSettings = {
        reviewResultFolderPath: input?.reviewResultFolderPath?.trim() || null,
      };
      return demoSettings;
    }
    case "get_review_result_preview": {
      const input = (
        args as { input?: GetReviewResultPreviewInput } | undefined
      )?.input;
      return demoReviewResultPreview(input?.pullRequestId);
    }
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
    case "add_azure_cli_organization": {
      const input = (
        args as { input?: AddAzureCliOrganizationInput } | undefined
      )?.input;
      return {
        ...demoOrganization,
        id: input?.organization || demoOrganization.id,
        name: input?.organization || demoOrganization.name,
        baseUrl: `https://dev.azure.com/${input?.organization || demoOrganization.name}`,
        authProvider: "azure_cli",
        credentialKey: `azdodeck:org:${input?.organization || demoOrganization.name}:azure-cli`,
      };
    }
    case "search_pull_requests":
      return demoPullRequests();
    case "list_my_review_pull_requests":
      return demoReviewPullRequests();
    case "search_work_items":
      return demoWorkItems();
    case "list_my_work_items":
      return demoMyWorkItems();
    case "search_commits": {
      const input = (args as { input?: SearchCommitsInput } | undefined)
        ?.input;
      return demoCommits(input);
    }
    case "list_commit_repositories":
      return demoCommitRepositories();
    default:
      throw new Error(`Unsupported demo command: ${command}`);
  }
}

function demoReviewResultPreview(
  pullRequestId: number | undefined,
): ReviewResultPreview | null {
  if (!demoSettings.reviewResultFolderPath || !pullRequestId) {
    return null;
  }
  if (pullRequestId !== 101 && pullRequestId !== 189) {
    return null;
  }

  const title =
    pullRequestId === 101
      ? "Rate limiting middleware review"
      : "Android payment crash review";
  return {
    pullRequestId,
    fileName: `review-PR${pullRequestId}.html`,
    filePath: `${demoSettings.reviewResultFolderPath}\\review-PR${pullRequestId}.html`,
    html: `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { color: #111827; font: 14px/1.5 system-ui, sans-serif; margin: 24px; }
      h1 { font-size: 20px; margin: 0 0 12px; }
      .status { background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; padding: 10px 12px; }
      code { background: #f3f4f6; border-radius: 4px; padding: 2px 4px; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <p class="status">Review result file matched by <code>PR${pullRequestId}</code>.</p>
    <p>No blocking issues found in the generated review summary.</p>
  </body>
</html>`,
  };
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

function demoMyWorkItems(): WorkItemSummary[] {
  return [
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      id: 201,
      title: "Implement My Work Items panel",
      workItemType: "Task",
      state: "Active",
      assignedTo: "Demo User",
      changedDate: "2026-05-25T08:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/201",
    },
    {
      organizationId: "contoso",
      projectId: "mobile",
      projectName: "Mobile",
      id: 187,
      title: "Fix crash on launch for Android 14",
      workItemType: "Bug",
      state: "Active",
      assignedTo: "Demo User",
      changedDate: "2026-05-24T14:30:00Z",
      webUrl: "https://dev.azure.com/contoso/Mobile/_workitems/edit/187",
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      id: 155,
      title: "Write ADR for auth middleware rewrite",
      workItemType: "Task",
      state: "New",
      assignedTo: "Demo User",
      changedDate: "2026-05-23T10:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/155",
    },
  ];
}

function demoReviewPullRequests(): ReviewPullRequestSummary[] {
  const now = new Date("2026-05-24T08:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const min = 60_000;
  const hr = 3_600_000;
  const day = 86_400_000;

  return [
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
      myVoteLabel: "Waiting for Author",
      myIsRequired: false,
      isDraft: false,
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
    },
  ];
}

function demoCommitRepositories(): CommitRepositoryOption[] {
  return [
    {
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "azdo-dashboard",
      repositoryName: "azdo-dashboard",
    },
    {
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "api-gateway",
      repositoryName: "api-gateway",
    },
    {
      projectId: "mobile",
      projectName: "Mobile",
      repositoryId: "android-app",
      repositoryName: "android-app",
    },
  ];
}

function demoCommits(input?: SearchCommitsInput): CommitSummary[] {
  const commits = [
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
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "api-gateway",
      repositoryName: "api-gateway",
      commitId: "1234567890abcdef1234567890abcdef12345678",
      shortCommitId: "12345678",
      comment: "Tune request tracing middleware",
      authorName: "Alice Johnson",
      authorEmail: "alice@example.com",
      authorDate: "2026-05-23T09:30:00Z",
      webUrl:
        "https://dev.azure.com/contoso/Platform/_git/api-gateway/commit/1234567890abcdef1234567890abcdef12345678",
    },
    {
      organizationId: "contoso",
      projectId: "mobile",
      projectName: "Mobile",
      repositoryId: "android-app",
      repositoryName: "android-app",
      commitId: "fedcba9876543210fedcba9876543210fedcba98",
      shortCommitId: "fedcba98",
      comment: "Fix payment flow back navigation",
      authorName: "Frank Lee",
      authorEmail: "frank@example.com",
      authorDate: "2026-05-22T03:15:00Z",
      webUrl:
        "https://dev.azure.com/contoso/Mobile/_git/android-app/commit/fedcba9876543210fedcba9876543210fedcba98",
    },
  ];

  const query = input?.query?.trim().toLowerCase();
  const author = input?.author?.trim().toLowerCase();
  const fromDate = input?.fromDate ? new Date(`${input.fromDate}T00:00:00Z`) : null;
  const toDate = input?.toDate ? new Date(`${input.toDate}T23:59:59Z`) : null;

  return commits.filter((commit) => {
    if (input?.projectId && commit.projectId !== input.projectId) {
      return false;
    }
    if (input?.repositoryId && commit.repositoryId !== input.repositoryId) {
      return false;
    }
    if (
      query &&
      ![
        commit.comment,
        commit.projectName,
        commit.repositoryName,
        commit.authorName ?? "",
        commit.authorEmail ?? "",
        commit.commitId,
      ].some((value) => value.toLowerCase().includes(query))
    ) {
      return false;
    }
    if (
      author &&
      ![commit.authorName ?? "", commit.authorEmail ?? ""].some((value) =>
        value.toLowerCase().includes(author),
      )
    ) {
      return false;
    }
    const authorDate = commit.authorDate ? new Date(commit.authorDate) : null;
    if (fromDate && authorDate && authorDate < fromDate) {
      return false;
    }
    if (toDate && authorDate && authorDate > toDate) {
      return false;
    }
    return true;
  });
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
