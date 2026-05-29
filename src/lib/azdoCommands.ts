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

const workItemProjectOptionSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
});

const workItemProjectOptionsSchema = z.array(workItemProjectOptionSchema);

export type WorkItemProjectOption = z.infer<typeof workItemProjectOptionSchema>;

const workItemCommentSchema = z.object({
  id: z.number(),
  text: z.string().nullable(),
  renderedText: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdById: z.string().nullable().optional(),
  createdByUniqueName: z.string().nullable().optional(),
  createdDate: z.string().nullable(),
});

export type WorkItemComment = z.infer<typeof workItemCommentSchema>;

const workItemPreviewSchema = z.object({
  organizationId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  id: z.number(),
  title: z.string(),
  workItemType: z.string().nullable(),
  state: z.string().nullable(),
  assignedTo: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdDate: z.string().nullable(),
  changedDate: z.string().nullable(),
  areaPath: z.string().nullable(),
  iterationPath: z.string().nullable(),
  reason: z.string().nullable(),
  tags: z.string().nullable(),
  priority: z.string().nullable(),
  severity: z.string().nullable(),
  storyPoints: z.string().nullable(),
  remainingWork: z.string().nullable(),
  descriptionHtml: z.string().nullable(),
  acceptanceCriteriaHtml: z.string().nullable(),
  webUrl: z.string().nullable(),
  comments: z.array(workItemCommentSchema).default([]),
});

export type WorkItemPreview = z.infer<typeof workItemPreviewSchema>;

const mentionCandidateSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  uniqueName: z.string().nullable(),
});

const mentionCandidatesSchema = z.array(mentionCandidateSchema);

export type MentionCandidate = z.infer<typeof mentionCandidateSchema>;

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

export type DeleteOrganizationInput = {
  id: string;
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
  projectId?: string;
  repositoryId?: string;
};

export type ListMyReviewPullRequestsInput = {
  organizationId?: string;
};

export type SearchWorkItemsInput = {
  organizationId?: string;
  query?: string;
  state?: string;
  workItemType?: string;
  projectId?: string;
};

export type RunWorkItemQueryInput = {
  organizationId?: string;
  projectId: string;
  wiql: string;
  limit?: number;
};

export type ListWorkItemProjectsInput = {
  organizationId?: string;
};

export type ListMyWorkItemsInput = {
  organizationId?: string;
};

export type GetWorkItemPreviewInput = {
  organizationId?: string;
  projectId: string;
  workItemId: number;
};

export type SearchWorkItemMentionsInput = {
  organizationId?: string;
  query: string;
};

export type AddWorkItemCommentInput = {
  organizationId?: string;
  projectId: string;
  workItemId: number;
  markdown: string;
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

export async function deleteOrganization(
  input: DeleteOrganizationInput,
): Promise<void> {
  await invokeCommand("delete_organization", { id: input.id });
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

export async function listWorkItemProjects(
  input: ListWorkItemProjectsInput,
): Promise<WorkItemProjectOption[]> {
  const result = await invokeCommand("list_work_item_projects", { input });
  return workItemProjectOptionsSchema.parse(result);
}

export async function runWorkItemQuery(
  input: RunWorkItemQueryInput,
): Promise<WorkItemSummary[]> {
  const result = await invokeCommand("run_work_item_query", { input });
  return workItemSummariesSchema.parse(result);
}

export async function getWorkItemPreview(
  input: GetWorkItemPreviewInput,
): Promise<WorkItemPreview> {
  const result = await invokeCommand("get_work_item_preview", { input });
  return workItemPreviewSchema.parse(result);
}

export async function searchWorkItemMentions(
  input: SearchWorkItemMentionsInput,
): Promise<MentionCandidate[]> {
  const result = await invokeCommand("search_work_item_mentions", { input });
  return mentionCandidatesSchema.parse(result);
}

export async function addWorkItemComment(
  input: AddWorkItemCommentInput,
): Promise<WorkItemComment> {
  const result = await invokeCommand("add_work_item_comment", { input });
  return workItemCommentSchema.parse(result);
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

export async function triggerSync(): Promise<void> {
  await invokeCommand("trigger_sync");
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
    case "search_pull_requests": {
      const input = (args as { input?: SearchPullRequestsInput } | undefined)?.input;
      return demoPullRequests(input);
    }
    case "list_my_review_pull_requests":
      return demoReviewPullRequests();
    case "search_work_items": {
      const input = (args as { input?: SearchWorkItemsInput } | undefined)?.input;
      return demoWorkItems(input);
    }
    case "list_my_work_items":
      return demoMyWorkItems();
    case "list_work_item_projects":
      return demoWorkItemProjects();
    case "run_work_item_query": {
      const input = (args as { input?: RunWorkItemQueryInput } | undefined)
        ?.input;
      return demoRunWorkItemQuery(input);
    }
    case "get_work_item_preview": {
      const input = (args as { input?: GetWorkItemPreviewInput } | undefined)
        ?.input;
      return demoWorkItemPreview(input);
    }
    case "search_work_item_mentions": {
      const input = (
        args as { input?: SearchWorkItemMentionsInput } | undefined
      )?.input;
      return demoMentionCandidates(input?.query);
    }
    case "add_work_item_comment": {
      const input = (args as { input?: AddWorkItemCommentInput } | undefined)
        ?.input;
      return demoWorkItemComment(input?.markdown);
    }
    case "search_commits": {
      const input = (args as { input?: SearchCommitsInput } | undefined)
        ?.input;
      return demoCommits(input);
    }
    case "list_commit_repositories":
      return demoCommitRepositories();
    case "delete_organization":
    case "trigger_sync":
      return null;
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

function demoPullRequests(input?: SearchPullRequestsInput): PullRequestSummary[] {
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
      webUrl: "https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/pullrequest/42",
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
      webUrl: "https://dev.azure.com/contoso/Platform/_git/api-gateway/pullrequest/103",
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
      webUrl: "https://dev.azure.com/contoso/Platform/_git/api-gateway/pullrequest/99",
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
      webUrl: "https://dev.azure.com/contoso/Mobile/_git/android-app/pullrequest/189",
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
      webUrl: "https://dev.azure.com/contoso/Mobile/_git/android-app/pullrequest/180",
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
      webUrl: "https://dev.azure.com/contoso/Infrastructure/_git/terraform-aws/pullrequest/55",
    },
  ];

  const query = input?.query?.trim().toLowerCase();
  const statusFilter = input?.status ?? "active";

  return all.filter((pr) => {
    if (input?.projectId && pr.projectId !== input.projectId) return false;
    if (input?.repositoryId && pr.repositoryId !== input.repositoryId) return false;
    if (statusFilter !== "all" && pr.status !== statusFilter) return false;
    if (
      query &&
      ![pr.title, pr.projectName, pr.repositoryName, pr.createdBy ?? "", pr.sourceRefName, pr.targetRefName].some(
        (v) => v.toLowerCase().includes(query),
      )
    )
      return false;
    return true;
  });
}

function demoWorkItems(input?: SearchWorkItemsInput): WorkItemSummary[] {
  const all: WorkItemSummary[] = [
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      id: 123,
      title: "Validate onboarding with PAT credentials",
      workItemType: "Task",
      state: "Active",
      assignedTo: "Demo User",
      changedDate: "2026-05-27T08:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/123",
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      id: 118,
      title: "Rate limiting middleware causes 429 cascade on retries",
      workItemType: "Bug",
      state: "Active",
      assignedTo: "Alice Johnson",
      changedDate: "2026-05-26T15:30:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/118",
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      id: 110,
      title: "Migrate token signing to RS256",
      workItemType: "User Story",
      state: "Resolved",
      assignedTo: "Bob Tanaka",
      changedDate: "2026-05-25T09:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/110",
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      id: 95,
      title: "Add OpenTelemetry span propagation to API gateway",
      workItemType: "Feature",
      state: "New",
      assignedTo: "Grace Chen",
      changedDate: "2026-05-24T11:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/95",
    },
    {
      organizationId: "contoso",
      projectId: "mobile",
      projectName: "Mobile",
      id: 187,
      title: "Fix crash on launch for Android 14",
      workItemType: "Bug",
      state: "Active",
      assignedTo: "Frank Lee",
      changedDate: "2026-05-26T14:30:00Z",
      webUrl: "https://dev.azure.com/contoso/Mobile/_workitems/edit/187",
    },
    {
      organizationId: "contoso",
      projectId: "mobile",
      projectName: "Mobile",
      id: 175,
      title: "Add biometric auth for payment screen",
      workItemType: "User Story",
      state: "Active",
      assignedTo: "Carol Wang",
      changedDate: "2026-05-25T16:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Mobile/_workitems/edit/175",
    },
    {
      organizationId: "contoso",
      projectId: "mobile",
      projectName: "Mobile",
      id: 160,
      title: "Dark mode support for all screens",
      workItemType: "Feature",
      state: "New",
      assignedTo: null,
      changedDate: "2026-05-23T08:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Mobile/_workitems/edit/160",
    },
    {
      organizationId: "contoso",
      projectId: "infrastructure",
      projectName: "Infrastructure",
      id: 51,
      title: "Upgrade EKS cluster to 1.29",
      workItemType: "Epic",
      state: "Active",
      assignedTo: "Eve Nakamura",
      changedDate: "2026-05-27T07:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Infrastructure/_workitems/edit/51",
    },
    {
      organizationId: "contoso",
      projectId: "infrastructure",
      projectName: "Infrastructure",
      id: 44,
      title: "Set up Datadog APM for production workloads",
      workItemType: "Task",
      state: "Closed",
      assignedTo: "Eve Nakamura",
      changedDate: "2026-05-20T12:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Infrastructure/_workitems/edit/44",
    },
  ];

  const query = input?.query?.trim().toLowerCase();
  const stateFilter = input?.state && input.state !== "all" ? input.state : undefined;
  const typeFilter = input?.workItemType?.trim() || undefined;

  return all.filter((item) => {
    if (input?.projectId && item.projectId !== input.projectId) return false;
    if (stateFilter && item.state !== stateFilter) return false;
    if (typeFilter && item.workItemType !== typeFilter) return false;
    if (
      query &&
      ![item.title, item.projectName, item.workItemType ?? "", item.state ?? "", item.assignedTo ?? ""].some(
        (v) => v.toLowerCase().includes(query),
      )
    )
      return false;
    return true;
  });
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
      changedDate: "2026-05-27T08:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/201",
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      id: 123,
      title: "Validate onboarding with PAT credentials",
      workItemType: "Task",
      state: "Active",
      assignedTo: "Demo User",
      changedDate: "2026-05-26T10:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/123",
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
      changedDate: "2026-05-25T14:30:00Z",
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
      changedDate: "2026-05-24T10:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/155",
    },
    {
      organizationId: "contoso",
      projectId: "infrastructure",
      projectName: "Infrastructure",
      id: 51,
      title: "Upgrade EKS cluster to 1.29",
      workItemType: "Epic",
      state: "Active",
      assignedTo: "Demo User",
      changedDate: "2026-05-23T07:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Infrastructure/_workitems/edit/51",
    },
  ];
}

function demoWorkItemProjects(): WorkItemProjectOption[] {
  const projects = new Map<string, string>();
  for (const item of [...demoWorkItems(), ...demoMyWorkItems()]) {
    projects.set(item.projectId, item.projectName);
  }
  return [...projects.entries()]
    .map(([projectId, projectName]) => ({ projectId, projectName }))
    .sort((a, b) => a.projectName.localeCompare(b.projectName));
}

function demoRunWorkItemQuery(input?: RunWorkItemQueryInput): WorkItemSummary[] {
  const wiql = input?.wiql.toLowerCase() ?? "";
  let results = demoWorkItems({ projectId: input?.projectId });

  const stateMatch = /\[system\.state\]\s*=\s*'([^']+)'/.exec(wiql);
  if (stateMatch) {
    const state = stateMatch[1].toLowerCase();
    results = results.filter((item) => item.state?.toLowerCase() === state);
  }

  const typeMatch = /\[system\.workitemtype\]\s*=\s*'([^']+)'/.exec(wiql);
  if (typeMatch) {
    const workItemType = typeMatch[1].toLowerCase();
    results = results.filter((item) => item.workItemType?.toLowerCase() === workItemType);
  }

  const titleMatch = /\[system\.title\]\s+contains\s+'([^']+)'/.exec(wiql);
  if (titleMatch) {
    const term = titleMatch[1].toLowerCase();
    results = results.filter((item) => item.title.toLowerCase().includes(term));
  }

  return results.slice(0, input?.limit ?? 200);
}

function demoWorkItemPreview(input?: GetWorkItemPreviewInput): WorkItemPreview {
  const allItems = [...demoWorkItems(), ...demoMyWorkItems()];
  const summary =
    allItems.find(
      (item) =>
        item.id === input?.workItemId &&
        (!input?.projectId || item.projectId === input.projectId),
    ) ?? allItems[0];

  return {
    organizationId: summary.organizationId,
    projectId: summary.projectId,
    projectName: summary.projectName,
    id: summary.id,
    title: summary.title,
    workItemType: summary.workItemType,
    state: summary.state,
    assignedTo: summary.assignedTo,
    createdBy: summary.assignedTo ?? "Demo User",
    createdDate: "2026-05-20T09:00:00Z",
    changedDate: summary.changedDate,
    areaPath: `${summary.projectName}\\Product`,
    iterationPath: `${summary.projectName}\\Sprint 24`,
    reason: summary.state === "Closed" ? "Completed" : "Work started",
    tags: "dashboard; preview; demo",
    priority: summary.workItemType === "Bug" ? "1" : "2",
    severity: summary.workItemType === "Bug" ? "2 - High" : null,
    storyPoints: summary.workItemType === "User Story" ? "5" : null,
    remainingWork: summary.workItemType === "Task" ? "3" : null,
    descriptionHtml: `<p>${escapeDemoHtml(summary.title)} の背景と期待する動作を確認します。</p><ul><li>Azure DevOps から詳細 field を取得</li><li>右側の preview pane に表示</li></ul>`,
    acceptanceCriteriaHtml:
      "<ul><li>一覧で選択した Work Item と preview が同期する</li><li>HTML field は sandbox 内で表示する</li></ul>",
    webUrl: summary.webUrl,
    comments: [
      {
        id: 2,
        text: "LGTM — shipped this in the last sprint, no blockers.",
        renderedText: "<p>LGTM — shipped this in the last sprint, no blockers.</p>",
        createdBy: "Alice Johnson",
        createdById: "demo-alice",
        createdByUniqueName: "alice@contoso.example",
        createdDate: "2026-05-27T14:00:00Z",
      },
      {
        id: 1,
        text: "Needs AC review before moving to Active.",
        renderedText: "<p>Needs AC review before moving to Active.</p>",
        createdBy: "Demo User",
        createdById: "demo-user",
        createdByUniqueName: "demo.user@contoso.example",
        createdDate: "2026-05-26T09:00:00Z",
      },
    ],
  };
}

const demoMentionPeople: MentionCandidate[] = [
  {
    id: "demo-alice",
    displayName: "Alice Johnson",
    uniqueName: "alice@contoso.example",
  },
  {
    id: "demo-bob",
    displayName: "Bob Tanaka",
    uniqueName: "bob@contoso.example",
  },
  {
    id: "demo-carol",
    displayName: "Carol Wang",
    uniqueName: "carol@contoso.example",
  },
  {
    id: "demo-frank",
    displayName: "Frank Lee",
    uniqueName: "frank@contoso.example",
  },
];

function demoMentionCandidates(query?: string): MentionCandidate[] {
  const term = query?.trim().toLowerCase() ?? "";
  if (!term) return demoMentionPeople;
  return demoMentionPeople.filter(
    (person) =>
      person.displayName.toLowerCase().includes(term) ||
      person.uniqueName?.toLowerCase().includes(term),
  );
}

function demoWorkItemComment(markdown?: string): WorkItemComment {
  return {
    id: Date.now(),
    text: markdown ?? "",
    renderedText: `<p>${escapeDemoHtml(markdown ?? "")}</p>`,
    createdBy: "Demo User",
    createdById: "demo-user",
    createdByUniqueName: "demo.user@contoso.example",
    createdDate: new Date().toISOString(),
  };
}

function escapeDemoHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
    {
      projectId: "infrastructure",
      projectName: "Infrastructure",
      repositoryId: "terraform-aws",
      repositoryName: "terraform-aws",
    },
  ];
}

function demoCommits(input?: SearchCommitsInput): CommitSummary[] {
  const commits: CommitSummary[] = [
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "azdo-dashboard",
      repositoryName: "azdo-dashboard",
      commitId: "abcdef1234567890abcdef1234567890abcdef12",
      shortCommitId: "abcdef12",
      comment: "Add commit search dashboard with grid view and keyboard nav",
      authorName: "Demo User",
      authorEmail: "demo@example.com",
      authorDate: "2026-05-27T08:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/commit/abcdef1234567890abcdef1234567890abcdef12",
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "azdo-dashboard",
      repositoryName: "azdo-dashboard",
      commitId: "beef1234567890abcdef1234567890abcdef1234",
      shortCommitId: "beef1234",
      comment: "feat(ui): add per-column resize handles to MyReviewsGrid",
      authorName: "Demo User",
      authorEmail: "demo@example.com",
      authorDate: "2026-05-26T14:30:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/commit/beef1234567890abcdef1234567890abcdef1234",
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "api-gateway",
      repositoryName: "api-gateway",
      commitId: "1234567890abcdef1234567890abcdef12345678",
      shortCommitId: "12345678",
      comment: "Tune request tracing middleware to reduce overhead",
      authorName: "Alice Johnson",
      authorEmail: "alice@example.com",
      authorDate: "2026-05-26T09:30:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_git/api-gateway/commit/1234567890abcdef1234567890abcdef12345678",
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      repositoryId: "api-gateway",
      repositoryName: "api-gateway",
      commitId: "cafe5678901234567890abcdef1234567890cafe",
      shortCommitId: "cafe5678",
      comment: "fix: correct Retry-After header parsing for rate limiting",
      authorName: "Bob Tanaka",
      authorEmail: "bob@example.com",
      authorDate: "2026-05-25T16:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_git/api-gateway/commit/cafe5678901234567890abcdef1234567890cafe",
    },
    {
      organizationId: "contoso",
      projectId: "mobile",
      projectName: "Mobile",
      repositoryId: "android-app",
      repositoryName: "android-app",
      commitId: "fedcba9876543210fedcba9876543210fedcba98",
      shortCommitId: "fedcba98",
      comment: "Fix payment flow back navigation crash on Android 14",
      authorName: "Frank Lee",
      authorEmail: "frank@example.com",
      authorDate: "2026-05-25T03:15:00Z",
      webUrl: "https://dev.azure.com/contoso/Mobile/_git/android-app/commit/fedcba9876543210fedcba9876543210fedcba98",
    },
    {
      organizationId: "contoso",
      projectId: "mobile",
      projectName: "Mobile",
      repositoryId: "android-app",
      repositoryName: "android-app",
      commitId: "dead1234567890abcdef1234567890abcdefdead",
      shortCommitId: "dead1234",
      comment: "Add biometric auth screen with fallback PIN entry",
      authorName: "Carol Wang",
      authorEmail: "carol@example.com",
      authorDate: "2026-05-24T11:45:00Z",
      webUrl: "https://dev.azure.com/contoso/Mobile/_git/android-app/commit/dead1234567890abcdef1234567890abcdefdead",
    },
    {
      organizationId: "contoso",
      projectId: "infrastructure",
      projectName: "Infrastructure",
      repositoryId: "terraform-aws",
      repositoryName: "terraform-aws",
      commitId: "f00d5678901234567890abcdef1234567890f00d",
      shortCommitId: "f00d5678",
      comment: "chore: bump EKS node group AMI to al2023-x86_64-1.29",
      authorName: "Eve Nakamura",
      authorEmail: "eve@example.com",
      authorDate: "2026-05-23T07:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Infrastructure/_git/terraform-aws/commit/f00d5678901234567890abcdef1234567890f00d",
    },
    {
      organizationId: "contoso",
      projectId: "infrastructure",
      projectName: "Infrastructure",
      repositoryId: "terraform-aws",
      repositoryName: "terraform-aws",
      commitId: "babe1234567890abcdef1234567890abcdefbabe",
      shortCommitId: "babe1234",
      comment: "feat: add Datadog APM agent to ECS task definitions",
      authorName: "Eve Nakamura",
      authorEmail: "eve@example.com",
      authorDate: "2026-05-21T13:20:00Z",
      webUrl: "https://dev.azure.com/contoso/Infrastructure/_git/terraform-aws/commit/babe1234567890abcdef1234567890abcdefbabe",
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
