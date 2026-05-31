import type {
  AddAzureCliOrganizationInput,
  AddPatOrganizationInput,
  AddWorkItemCommentInput,
  AppSettings,
  AssignWorkItemInput,
  AssignWorkItemsInput,
  CommitRepositoryOption,
  CommitSummary,
  DeleteWorkItemCommentInput,
  GetReviewResultPreviewInput,
  GetSavedQueryInput,
  GetWorkItemPreviewInput,
  ListWorkItemTypeStatesInput,
  MentionCandidate,
  Organization,
  PullRequestSummary,
  ReviewPullRequestSummary,
  ReviewResultPreview,
  RunWorkItemQueryInput,
  SearchCommitsInput,
  SearchPullRequestsInput,
  SearchWorkItemMentionsInput,
  SearchWorkItemsInput,
  SetWorkItemsStateInput,
  SetWorkItemStateInput,
  UpdateAppSettingsInput,
  WorkItemComment,
  WorkItemPreview,
  WorkItemProjectOption,
  WorkItemSummary,
} from "@/lib/azdoCommands";
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

const DEMO_PREVIEW_IMAGE_DATA_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='92' viewBox='0 0 320 92'%3E%3Crect width='320' height='92' rx='8' fill='%23eff6ff'/%3E%3Crect x='14' y='14' width='88' height='64' rx='5' fill='%232563eb'/%3E%3Crect x='116' y='22' width='178' height='10' rx='5' fill='%2393c5fd'/%3E%3Crect x='116' y='42' width='148' height='10' rx='5' fill='%23bfdbfe'/%3E%3Crect x='116' y='62' width='118' height='10' rx='5' fill='%23dbeafe'/%3E%3C/svg%3E";

let demoSettings: AppSettings = {
  reviewResultFolderPath: "C:\\reports\\azdo-reviews",
  showWindowHotkey: null,
};
const deletedDemoWorkItemComments = new Set<number>();

export async function demoInvoke(command: string, args?: unknown): Promise<unknown> {
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
        reviewResultFolderPath:
          input && "reviewResultFolderPath" in input
            ? input.reviewResultFolderPath?.trim() || null
            : demoSettings.reviewResultFolderPath,
        showWindowHotkey:
          input && "showWindowHotkey" in input
            ? input.showWindowHotkey?.trim() || null
            : demoSettings.showWindowHotkey,
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
    case "count_work_item_query": {
      const input = (args as { input?: RunWorkItemQueryInput } | undefined)
        ?.input;
      return demoRunWorkItemQuery(input).length;
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
    case "fetch_work_item_image": {
      return { dataUrl: DEMO_PREVIEW_IMAGE_DATA_URL };
    }
    case "add_work_item_comment": {
      const input = (args as { input?: AddWorkItemCommentInput } | undefined)
        ?.input;
      return demoWorkItemComment(input?.markdown);
    }
    case "delete_work_item_comment": {
      const input = (args as { input?: DeleteWorkItemCommentInput } | undefined)
        ?.input;
      if (input) deletedDemoWorkItemComments.add(input.commentId);
      return null;
    }
    case "assign_work_item": {
      const input = (args as { input?: AssignWorkItemInput } | undefined)
        ?.input;
      return demoAssignWorkItem(input);
    }
    case "set_work_item_state": {
      const input = (args as { input?: SetWorkItemStateInput } | undefined)
        ?.input;
      return demoSetWorkItemState(input);
    }
    case "list_work_item_type_states": {
      const input = (args as { input?: ListWorkItemTypeStatesInput } | undefined)
        ?.input;
      return demoListWorkItemTypeStates(input);
    }
    case "set_work_items_state": {
      const input = (args as { input?: SetWorkItemsStateInput } | undefined)?.input;
      return (input?.workItemIds ?? []).map((id) => ({ id, error: null }));
    }
    case "assign_work_items": {
      const input = (args as { input?: AssignWorkItemsInput } | undefined)?.input;
      return (input?.workItemIds ?? []).map((id) => ({ id, error: null }));
    }
    case "search_commits": {
      const input = (args as { input?: SearchCommitsInput } | undefined)
        ?.input;
      return demoCommits(input);
    }
    case "list_commit_repositories":
      return demoCommitRepositories();
    case "get_saved_query": {
      const input = (args as { input?: GetSavedQueryInput } | undefined)?.input;
      const queryId = input?.queryId ?? "";
      if (queryId === "00000000-0000-0000-0000-000000000000") {
        return { id: queryId, name: "My Queries (folder)", wiql: null };
      }
      return {
        id: queryId || "demo-query-id",
        name: "Demo Imported Query",
        wiql: "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.ChangedDate] DESC",
      };
    }
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
    descriptionHtml: `<p>Review background and expected behavior for ${escapeDemoHtml(summary.title)}.</p><ul><li>Fetch detail fields from Azure DevOps</li><li>Display in the right-side preview pane</li></ul><p><img alt="Demo preview image" src="https://dev.azure.com/contoso/${encodeURIComponent(summary.projectName)}/_apis/wit/attachments/demo-preview-image?fileName=preview.svg"></p>`,
    acceptanceCriteriaHtml:
      "<ul><li>Selected work item syncs with the preview pane</li><li>HTML fields are rendered in a sandbox</li></ul>",
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
    ].filter((comment) => !deletedDemoWorkItemComments.has(comment.id)),
  };
}

function demoAssignWorkItem(input?: AssignWorkItemInput): WorkItemPreview {
  const preview = demoWorkItemPreview(
    input
      ? {
          organizationId: input.organizationId,
          projectId: input.projectId,
          workItemId: input.workItemId,
        }
      : undefined,
  );
  const assignee = input?.assignedTo?.trim();
  if (!assignee) return preview;
  const person = demoMentionPeople.find(
    (candidate) =>
      candidate.uniqueName?.toLowerCase() === assignee.toLowerCase() ||
      candidate.displayName.toLowerCase() === assignee.toLowerCase(),
  );
  return {
    ...preview,
    assignedTo: person?.displayName ?? assignee,
    changedDate: new Date().toISOString(),
  };
}

function demoSetWorkItemState(input?: SetWorkItemStateInput): WorkItemPreview {
  const preview = demoWorkItemPreview(
    input
      ? { organizationId: input.organizationId, projectId: input.projectId, workItemId: input.workItemId }
      : undefined,
  );
  if (!input?.state?.trim()) return preview;
  return { ...preview, state: input.state.trim(), changedDate: new Date().toISOString() };
}

const DEMO_STATES_BY_TYPE: Record<string, string[]> = {
  Bug: ["New", "Active", "Resolved", "Closed"],
  Task: ["To Do", "In Progress", "Done"],
  "User Story": ["New", "Active", "Resolved", "Closed"],
  Feature: ["New", "In Progress", "Resolved", "Closed"],
  Epic: ["New", "In Progress", "Resolved", "Closed"],
  Issue: ["To Do", "Doing", "Done"],
};
const DEMO_STATES_FALLBACK = ["New", "Active", "Resolved", "Closed"];

function demoListWorkItemTypeStates(input?: ListWorkItemTypeStatesInput): string[] {
  if (!input?.workItemType) return DEMO_STATES_FALLBACK;
  return DEMO_STATES_BY_TYPE[input.workItemType] ?? DEMO_STATES_FALLBACK;
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


