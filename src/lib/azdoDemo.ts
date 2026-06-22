import type {
  AddAzureCliOrganizationInput,
  AddPatOrganizationInput,
  AddWorkItemCommentInput,
  AppSettings,
  AssignWorkItemsInput,
  CommitActivityDay,
  CommitActivityInput,
  CommitPullRequest,
  CommitRepositoryOption,
  CommitSummary,
  DeleteWorkItemCommentInput,
  DeletePullRequestCommentInput,
  EditPullRequestCommentInput,
  GetPullRequestFileDiffInput,
  GetPullRequestReviewInput,
  GetReviewResultPreviewInput,
  GetSavedQueryInput,
  ListPullRequestChangesInput,
  GetWorkItemPreviewInput,
  ListWorkItemTypeStatesInput,
  ListWorkItemFieldsInput,
  MentionCandidate,
  Organization,
  PostPullRequestCommentInput,
  PrChangedFile,
  PrCommit,
  PrFileDiff,
  PrThread,
  PullRequestChanges,
  PullRequestReview,
  PullRequestSummary,
  ReviewPullRequestSummary,
  ReviewResultPreview,
  SnoozedItemSummary,
  SetPullRequestThreadStatusInput,
  SubmitPullRequestVoteInput,
  RunWorkItemQueryInput,
  SearchAllInput,
  SearchAllResult,
  SearchCommitsInput,
  SearchWorkItemAssigneesInput,
  SearchPullRequestsInput,
  SearchPullRequestMentionsInput,
  SearchWorkItemMentionsInput,
  SearchWorkItemsInput,
  UpdateWorkItemCommentInput,
  UpdateWorkItemFieldsInput,
  ListWorkItemFieldAllowedValuesInput,
  SetWorkItemsPriorityInput,
  SetWorkItemsStateInput,
  SyncState,
  UpdateAppSettingsInput,
  WorkItemComment,
  WorkItemAssigneeCandidate,
  WorkItemFieldOption,
  WorkItemPreview,
  WorkItemProjectOption,
  WorkItemSummary,
  WorkItemUpdateSummary,
} from "@/lib/azdoCommands";
import {
  DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS,
  DEFAULT_REVIEW_STALE_THRESHOLD_DAYS,
} from "@/lib/reviewSettings";
import {
  applyPullRequestScenario,
  applyReviewPullRequestScenario,
  applyWorkItemPreviewScenario,
  applyWorkItemScenario,
  demoResponseDelayMs,
  shouldFailDemoCommand,
} from "@/lib/azdoDemoHarness";
const demoOrganization: Organization = {
  id: "contoso",
  name: "contoso",
  displayName: "Contoso",
  baseUrl: "https://dev.azure.com/contoso",
  authProvider: "pat",
  credentialKey: "azdodeck:org:contoso:pat",
  authenticatedUserId: "demo-user",
  authenticatedUserDisplayName: "Demo User",
  authenticatedUserUniqueName: "demo.user@example.com",
  createdAt: "2026-05-24T00:00:00Z",
  updatedAt: "2026-05-24T00:00:00Z",
};

const DEMO_PREVIEW_IMAGE_DATA_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='92' viewBox='0 0 320 92'%3E%3Crect width='320' height='92' rx='8' fill='%23eff6ff'/%3E%3Crect x='14' y='14' width='88' height='64' rx='5' fill='%232563eb'/%3E%3Crect x='116' y='22' width='178' height='10' rx='5' fill='%2393c5fd'/%3E%3Crect x='116' y='42' width='148' height='10' rx='5' fill='%23bfdbfe'/%3E%3Crect x='116' y='62' width='118' height='10' rx='5' fill='%23dbeafe'/%3E%3C/svg%3E";

let demoSettings: AppSettings = {
  reviewResultFolderPath: "C:\\reports\\azdo-reviews",
  showWindowHotkey: null,
  readOnlyValidationModeEnabled: false,
  desktopNotificationsEnabled: false,
  notificationContentPreviewEnabled: true,
  notifyWorkItemAssignments: true,
  notifyWorkItemStateChanges: true,
  notifyPrReviewRequests: true,
  notifyPrVoteResets: true,
  notifyPrCommentReplies: true,
  reviewStaleThresholdDays: DEFAULT_REVIEW_STALE_THRESHOLD_DAYS,
  workItemStaleThresholdDays: DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS,
  notificationRules: [],
};
const deletedDemoWorkItemComments = new Set<number>();
let demoSyncStates: SyncState[] = [
  {
    scope: "prs:contoso",
    orgId: "contoso",
    lastSyncedAt: "2026-05-27T08:00:00Z",
    errorCount: 0,
    lastError: null,
    lastWarning: null,
  },
  {
    scope: "work_items:contoso",
    orgId: "contoso",
    lastSyncedAt: "2026-05-27T08:00:00Z",
    errorCount: 0,
    lastError: null,
    lastWarning:
      "Work item sync fetched more than 200 IDs in 1 query result(s); largest result had 248 IDs and was loaded in batches.",
  },
];
const writeCommands = new Set([
  "add_work_item_comment",
  "delete_work_item_comment",
  "update_work_item_comment",
  "update_work_item_fields",
  "set_work_items_state",
  "assign_work_items",
  "set_work_items_priority",
  "post_pull_request_comment",
  "set_pull_request_thread_status",
  "submit_pull_request_vote",
  "update_pull_request",
  "edit_pull_request_comment",
  "delete_pull_request_comment",
  "rerun_pipeline_run",
  "cancel_pipeline_run",
]);

let demoPrThreadSeq = 100;
const demoPrVotes = new Map<number, number>();

// In-memory snooze store for browser demo mode, keyed by `${itemType}:${itemKey}`
// with the snooze deadline as the value. Auto-revival is not simulated; demo
// snoozes simply hide items until manually unsnoozed.
const demoSnoozes = new Map<string, string>();

function demoSnoozeStoreKey(itemType: string, itemKey: string): string {
  return `${itemType}:${itemKey}`;
}

function demoSnoozedKeys(itemType: string): Set<string> {
  const keys = new Set<string>();
  for (const stored of demoSnoozes.keys()) {
    const prefix = `${itemType}:`;
    if (stored.startsWith(prefix)) {
      keys.add(stored.slice(prefix.length));
    }
  }
  return keys;
}
const demoPrThreads = new Map<number, PrThread[]>();

function demoVoteLabel(vote: number): string {
  switch (vote) {
    case 10:
      return "Approved";
    case 5:
      return "Approved w/ Suggestions";
    case -5:
      return "Waiting for Author";
    case -10:
      return "Rejected";
    default:
      return "No Vote";
  }
}

function demoThreadsFor(pullRequestId: number): PrThread[] {
  const existing = demoPrThreads.get(pullRequestId);
  if (existing) return existing;
  const threads: PrThread[] = [
    {
      id: 1,
      status: "active",
      isResolved: false,
      filePath: null,
      rightLine: null,
      leftLine: null,
      comments: [
        {
          id: 1,
          parentCommentId: 0,
          content: "Could you add a test for the empty case?",
          author: "Riley Reviewer",
          publishedDate: "2026-05-22T09:00:00Z",
          isSystem: false,
          isMine: false,
        },
      ],
    },
    {
      id: 2,
      status: "closed",
      isResolved: true,
      filePath: "/src/app/dashboard.ts",
      rightLine: 2,
      leftLine: null,
      comments: [
        {
          id: 1,
          parentCommentId: 0,
          content: "This constant should be configurable.",
          author: "Riley Reviewer",
          publishedDate: "2026-05-21T15:00:00Z",
          isSystem: false,
          isMine: false,
        },
        {
          id: 2,
          parentCommentId: 1,
          content: "Fixed in the latest iteration.",
          author: "Demo User",
          publishedDate: "2026-05-22T10:00:00Z",
          isSystem: false,
          isMine: true,
        },
      ],
    },
    {
      id: 3,
      status: null,
      isResolved: false,
      filePath: null,
      rightLine: null,
      leftLine: null,
      comments: [
        {
          id: 1,
          parentCommentId: 0,
          content: "Riley Reviewer voted 10",
          author: "Riley Reviewer",
          publishedDate: "2026-05-20T12:00:00Z",
          isSystem: true,
          isMine: false,
        },
      ],
    },
  ];
  demoPrThreads.set(pullRequestId, threads);
  return threads;
}

// Per-PR changed files so the multi-select conflict-overlap warning has
// something to detect in browser/demo mode. PRs share `/src/app/dashboard.ts`
// to produce a visible overlap; odd PR ids also share a config file.
function demoPrFilesFor(pullRequestId: number): PrChangedFile[] {
  const files: PrChangedFile[] = [
    { path: "/src/app/dashboard.ts", changeType: "edit", originalPath: null },
    { path: `/src/app/feature-${pullRequestId}.ts`, changeType: "add", originalPath: null },
  ];
  if (pullRequestId % 2 === 1) {
    files.push({ path: "/src/app/config.ts", changeType: "edit", originalPath: null });
  }
  return files;
}

const DEMO_DIFF_BASE = `import { fetchData } from "./api";
import { Logger } from "./logger";

const logger = new Logger("dashboard");

export function loadDashboard() {
  const refreshIntervalMs = 30000;
  logger.info("loading dashboard");
  return fetchData(refreshIntervalMs);
}

// The widgets below stay unchanged across iterations, so a reviewer can fold
// this section away while focusing on the edited code above and below it.
export const widgets = [
  { id: "cpu", label: "CPU" },
  { id: "memory", label: "Memory" },
  { id: "disk", label: "Disk" },
  { id: "network", label: "Network" },
  { id: "errors", label: "Errors" },
  { id: "latency", label: "Latency" },
  { id: "throughput", label: "Throughput" },
];

export function summarize(widgetId: string) {
  const widget = widgets.find((candidate) => candidate.id === widgetId);
  return widget ? widget.label : "unknown";
}
`;
const demoPrCommits: PrCommit[] = [
  {
    commitId: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    shortCommitId: "a1b2c3d4",
    comment: "Make the refresh interval configurable",
    authorName: "Avery Author",
    authorDate: "2026-05-22T10:00:00Z",
    webUrl:
      "https://dev.azure.com/contoso/platform/_git/api-gateway/commit/a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  },
  {
    commitId: "b2c3d4e5f60718293a4b5c6d7e8f901234567890",
    shortCommitId: "b2c3d4e5",
    comment: "Extract useDashboardData hook",
    authorName: "Avery Author",
    authorDate: "2026-05-21T16:30:00Z",
    webUrl:
      "https://dev.azure.com/contoso/platform/_git/api-gateway/commit/b2c3d4e5f60718293a4b5c6d7e8f901234567890",
  },
  {
    commitId: "c3d4e5f60718293a4b5c6d7e8f90123456789012",
    shortCommitId: "c3d4e5f6",
    comment: "Remove the legacy dashboard loader",
    authorName: "Avery Author",
    authorDate: "2026-05-20T09:15:00Z",
    webUrl:
      "https://dev.azure.com/contoso/platform/_git/api-gateway/commit/c3d4e5f60718293a4b5c6d7e8f90123456789012",
  },
];

const DEMO_DIFF_TARGET = `import { fetchData } from "./api";
import { Logger } from "./logger";

const logger = new Logger("dashboard");

export function loadDashboard(options: DashboardOptions) {
  const refreshIntervalMs = options.refreshIntervalMs ?? 30000;
  logger.info("loading dashboard");
  return fetchData(refreshIntervalMs);
}

// The widgets below stay unchanged across iterations, so a reviewer can fold
// this section away while focusing on the edited code above and below it.
export const widgets = [
  { id: "cpu", label: "CPU" },
  { id: "memory", label: "Memory" },
  { id: "disk", label: "Disk" },
  { id: "network", label: "Network" },
  { id: "errors", label: "Errors" },
  { id: "latency", label: "Latency" },
  { id: "throughput", label: "Throughput" },
];

export function summarize(widgetId: string) {
  const widget = widgets.find((candidate) => candidate.id === widgetId);
  return widget ? \`\${widget.label} — a deliberately long, unchanged-but-reflowed descriptive suffix that shows how split view now wraps very long lines instead of clipping them\` : "unknown";
}
`;

function demoPipelineProjects() {
  return [
    { id: "demo-project", name: "Demo Project" },
    { id: "demo-tools", name: "Tooling" },
  ];
}

function demoPipelineDefinitions() {
  return [
    { id: 1, name: "CI" },
    { id: 2, name: "Nightly" },
  ];
}

function demoPipelineRuns() {
  return [
    {
      organizationId: "contoso",
      projectId: "demo-project",
      projectName: "Demo Project",
      buildId: 1001,
      buildNumber: "20260613.3",
      definitionId: 1,
      definitionName: "CI",
      status: "completed",
      result: "succeeded",
      sourceBranch: "refs/heads/main",
      reason: "individualCI",
      requestedFor: "Demo User",
      queueTime: "2026-06-13T09:00:00Z",
      startTime: "2026-06-13T09:00:05Z",
      finishTime: "2026-06-13T09:04:00Z",
      webUrl: "https://dev.azure.com/demo/demo/_build/results?buildId=1001",
    },
    {
      organizationId: "contoso",
      projectId: "demo-project",
      projectName: "Demo Project",
      buildId: 1002,
      buildNumber: "20260613.4",
      definitionId: 1,
      definitionName: "CI",
      status: "completed",
      result: "failed",
      sourceBranch: "refs/heads/feature/login",
      reason: "pullRequest",
      requestedFor: "Demo User",
      queueTime: "2026-06-13T10:00:00Z",
      startTime: "2026-06-13T10:00:05Z",
      finishTime: "2026-06-13T10:02:30Z",
      webUrl: "https://dev.azure.com/demo/demo/_build/results?buildId=1002",
    },
    {
      organizationId: "contoso",
      projectId: "demo-project",
      projectName: "Demo Project",
      buildId: 1003,
      buildNumber: "20260613.5",
      definitionId: 2,
      definitionName: "Nightly",
      status: "inProgress",
      result: null,
      sourceBranch: "refs/heads/main",
      reason: "schedule",
      requestedFor: "Scheduler",
      queueTime: "2026-06-13T11:00:00Z",
      startTime: "2026-06-13T11:00:05Z",
      finishTime: null,
      webUrl: "https://dev.azure.com/demo/demo/_build/results?buildId=1003",
    },
  ];
}

function demoPipelineRunDetail(buildId: number) {
  const runs = demoPipelineRuns();
  const run = runs.find((r) => r.buildId === buildId) ?? runs[0];
  return {
    run,
    timeline: [
      {
        id: "stage-1",
        parentId: null,
        nodeType: "Stage",
        name: "Build",
        state: "completed",
        result: run.result ?? "succeeded",
        startTime: run.startTime,
        finishTime: run.finishTime,
        logId: null,
        errorCount: run.result === "failed" ? 1 : 0,
        warningCount: 0,
        order: 1,
      },
      {
        id: "job-1",
        parentId: "stage-1",
        nodeType: "Job",
        name: "Compile",
        state: "completed",
        result: run.result ?? "succeeded",
        startTime: run.startTime,
        finishTime: run.finishTime,
        logId: 7,
        errorCount: run.result === "failed" ? 1 : 0,
        warningCount: 0,
        order: 1,
      },
    ],
  };
}

export async function demoInvoke(command: string, args?: unknown): Promise<unknown> {
  await new Promise((resolve) => window.setTimeout(resolve, demoResponseDelayMs()));

  if (shouldFailDemoCommand(command)) {
    throw new Error(`Demo harness forced ${command} to fail`);
  }
  if (writeCommands.has(command) && demoSettings.readOnlyValidationModeEnabled) {
    throw new Error(
      "Read-only validation mode is enabled. Disable it in Settings to write to Azure DevOps.",
    );
  }

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
        readOnlyValidationModeEnabled:
          input && "readOnlyValidationModeEnabled" in input
            ? Boolean(input.readOnlyValidationModeEnabled)
            : demoSettings.readOnlyValidationModeEnabled,
        desktopNotificationsEnabled:
          input && "desktopNotificationsEnabled" in input
            ? Boolean(input.desktopNotificationsEnabled)
            : demoSettings.desktopNotificationsEnabled,
        notificationContentPreviewEnabled:
          input && "notificationContentPreviewEnabled" in input
            ? Boolean(input.notificationContentPreviewEnabled)
            : demoSettings.notificationContentPreviewEnabled,
        notifyWorkItemAssignments:
          input && "notifyWorkItemAssignments" in input
            ? Boolean(input.notifyWorkItemAssignments)
            : demoSettings.notifyWorkItemAssignments,
        notifyWorkItemStateChanges:
          input && "notifyWorkItemStateChanges" in input
            ? Boolean(input.notifyWorkItemStateChanges)
            : demoSettings.notifyWorkItemStateChanges,
        notifyPrReviewRequests:
          input && "notifyPrReviewRequests" in input
            ? Boolean(input.notifyPrReviewRequests)
            : demoSettings.notifyPrReviewRequests,
        notifyPrVoteResets:
          input && "notifyPrVoteResets" in input
            ? Boolean(input.notifyPrVoteResets)
            : demoSettings.notifyPrVoteResets,
        notifyPrCommentReplies:
          input && "notifyPrCommentReplies" in input
            ? Boolean(input.notifyPrCommentReplies)
            : demoSettings.notifyPrCommentReplies,
        reviewStaleThresholdDays:
          input && "reviewStaleThresholdDays" in input
            ? Number(input.reviewStaleThresholdDays) ||
              DEFAULT_REVIEW_STALE_THRESHOLD_DAYS
            : demoSettings.reviewStaleThresholdDays,
        workItemStaleThresholdDays:
          input && "workItemStaleThresholdDays" in input
            ? Number(input.workItemStaleThresholdDays) ||
              DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS
            : demoSettings.workItemStaleThresholdDays,
        notificationRules:
          input && "notificationRules" in input
            ? (input.notificationRules ?? [])
            : demoSettings.notificationRules,
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
    case "list_my_review_pull_requests": {
      const snoozed = demoSnoozedKeys("pull_request");
      return demoReviewPullRequests().filter(
        (pr) => !snoozed.has(`${pr.repositoryId}:${pr.pullRequestId}`),
      );
    }
    case "get_pull_request_review": {
      const input = (args as { input?: GetPullRequestReviewInput } | undefined)?.input;
      const prId = input?.pullRequestId ?? 0;
      const summary = demoReviewPullRequests().find((pr) => pr.pullRequestId === prId);
      const myVote = demoPrVotes.get(prId) ?? summary?.myVote ?? 0;
      const review: PullRequestReview = {
        pullRequestId: prId,
        title: summary?.title ?? `Demo pull request #${prId}`,
        description:
          "## Summary\nImproves the dashboard loading flow. Implements AB#123 and partially addresses AB#187.\n\n- configurable refresh interval\n- removes the legacy loader",
        // Backend strips refs/heads/ in get_review; mirror that here.
        sourceRefName: "feature/dashboard-loading",
        targetRefName: summary?.targetRefName ?? "main",
        createdBy: summary?.createdBy ?? "Avery Author",
        creationDate: summary?.creationDate ?? "2026-05-20T08:00:00Z",
        isDraft: summary?.isDraft ?? false,
        reviewers: [
          {
            displayName: "Demo User",
            vote: myVote,
            voteLabel: demoVoteLabel(myVote),
            isRequired: summary?.myIsRequired ?? true,
            isMe: true,
          },
          {
            displayName: "Riley Reviewer",
            vote: 10,
            voteLabel: "Approved",
            isRequired: false,
            isMe: false,
          },
        ],
        threads: demoThreadsFor(prId),
      };
      return review;
    }
    case "list_pull_request_commits":
      return demoPrCommits;
    case "list_pull_request_changes": {
      const input = (args as { input?: ListPullRequestChangesInput } | undefined)?.input;
      const changes: PullRequestChanges = {
        baseCommitId: "demo-base",
        targetCommitId: "demo-target",
        files: demoPrFilesFor(input?.pullRequestId ?? 0),
      };
      return changes;
    }
    case "get_pull_request_file_diff": {
      const input = (args as { input?: GetPullRequestFileDiffInput } | undefined)?.input;
      const filePath = input?.filePath ?? "";
      if (filePath.endsWith(".png")) {
        const diff: PrFileDiff = {
          filePath,
          baseContent: null,
          targetContent: null,
          baseUnavailableReason: null,
          targetUnavailableReason: "binary",
        };
        return diff;
      }
      const tokens = (input?.changeType ?? "edit")
        .toLowerCase()
        .split(",")
        .map((token) => token.trim());
      const isAdd = tokens.includes("add") || tokens.includes("undelete");
      const isDelete = tokens.includes("delete");
      const diff: PrFileDiff = {
        filePath,
        baseContent: isAdd ? null : DEMO_DIFF_BASE,
        targetContent: isDelete ? null : DEMO_DIFF_TARGET,
        baseUnavailableReason: null,
        targetUnavailableReason: null,
      };
      return diff;
    }
    case "post_pull_request_comment": {
      const input = (args as { input?: PostPullRequestCommentInput } | undefined)?.input;
      if (!input) throw new Error("missing input");
      const threads = demoThreadsFor(input.pullRequestId);
      if (input.threadId != null) {
        const thread = threads.find((candidate) => candidate.id === input.threadId);
        if (!thread) throw new Error(`thread not found: ${input.threadId}`);
        thread.comments.push({
          id: thread.comments.length + 1,
          parentCommentId: thread.comments[0]?.id ?? 0,
          content: input.content,
          author: "Demo User",
          publishedDate: new Date().toISOString(),
          isSystem: false,
          isMine: true,
        });
        return thread;
      }
      const thread: PrThread = {
        id: ++demoPrThreadSeq,
        status: "active",
        isResolved: false,
        filePath: input.filePath ?? null,
        rightLine: input.rightLine ?? null,
        leftLine: input.leftLine ?? null,
        comments: [
          {
            id: 1,
            parentCommentId: 0,
            content: input.content,
            author: "Demo User",
            publishedDate: new Date().toISOString(),
            isSystem: false,
            isMine: true,
          },
        ],
      };
      threads.unshift(thread);
      return thread;
    }
    case "edit_pull_request_comment": {
      const input = (args as { input?: EditPullRequestCommentInput } | undefined)?.input;
      if (!input) throw new Error("missing input");
      const thread = demoThreadsFor(input.pullRequestId).find(
        (candidate) => candidate.id === input.threadId,
      );
      if (!thread) throw new Error(`thread not found: ${input.threadId}`);
      const comment = thread.comments.find((candidate) => candidate.id === input.commentId);
      if (comment) comment.content = input.content;
      return thread;
    }
    case "delete_pull_request_comment": {
      const input = (args as { input?: DeletePullRequestCommentInput } | undefined)?.input;
      if (!input) throw new Error("missing input");
      const thread = demoThreadsFor(input.pullRequestId).find(
        (candidate) => candidate.id === input.threadId,
      );
      if (thread) {
        thread.comments = thread.comments.filter((candidate) => candidate.id !== input.commentId);
      }
      return null;
    }
    case "set_pull_request_thread_status": {
      const input = (args as { input?: SetPullRequestThreadStatusInput } | undefined)?.input;
      if (!input) throw new Error("missing input");
      const thread = demoThreadsFor(input.pullRequestId).find(
        (candidate) => candidate.id === input.threadId,
      );
      if (!thread) throw new Error(`thread not found: ${input.threadId}`);
      thread.status = input.status;
      thread.isResolved = input.status === "closed";
      return thread;
    }
    case "submit_pull_request_vote": {
      const input = (args as { input?: SubmitPullRequestVoteInput } | undefined)?.input;
      if (!input) throw new Error("missing input");
      demoPrVotes.set(input.pullRequestId, input.vote);
      return {
        displayName: "Demo User",
        vote: input.vote,
        voteLabel: demoVoteLabel(input.vote),
        isRequired: true,
        isMe: true,
      };
    }
    case "update_pull_request": {
      const input = (args as { input?: { action?: string; pullRequestId?: number } } | undefined)
        ?.input;
      const action = input?.action;
      // publish and complete clear draft; abandon/reactivate keep the PR's original draft state.
      const originalDraft =
        demoReviewPullRequests().find((pr) => pr.pullRequestId === input?.pullRequestId)?.isDraft ??
        false;
      const isDraft = action === "publish" || action === "complete" ? false : originalDraft;
      return {
        status: action === "abandon" ? "abandoned" : action === "complete" ? "completed" : "active",
        isDraft,
      };
    }
    case "search_work_items": {
      const input = (args as { input?: SearchWorkItemsInput } | undefined)?.input;
      return demoWorkItems(input);
    }
    case "search_all": {
      const input = (args as { input?: SearchAllInput } | undefined)?.input;
      const query = input?.query.trim() ?? "";
      const limit = input?.limitPerKind ?? 5;
      if (!query) {
        return {
          workItems: [],
          pullRequests: [],
          commits: [],
          totals: { workItems: 0, pullRequests: 0, commits: 0 },
        } satisfies SearchAllResult;
      }
      const workItems = demoWorkItems({ query });
      const pullRequests = demoPullRequests({ query });
      const commits = demoCommits({ query });
      return {
        workItems: workItems.slice(0, limit),
        pullRequests: pullRequests.slice(0, limit),
        commits: commits.slice(0, limit),
        totals: {
          workItems: workItems.length,
          pullRequests: pullRequests.length,
          commits: commits.length,
        },
      } satisfies SearchAllResult;
    }
    case "list_my_work_items": {
      const snoozed = demoSnoozedKeys("work_item");
      return demoMyWorkItems().filter(
        (item) => !snoozed.has(String(item.id)),
      );
    }
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
    case "search_pull_request_mentions": {
      const input = (
        args as { input?: SearchPullRequestMentionsInput } | undefined
      )?.input;
      return demoMentionCandidates(input?.query);
    }
    case "search_work_item_assignees": {
      const input = (
        args as { input?: SearchWorkItemAssigneesInput } | undefined
      )?.input;
      return demoAssigneeCandidates(input?.query);
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
    case "update_work_item_comment": {
      const input = (args as { input?: UpdateWorkItemCommentInput } | undefined)
        ?.input;
      const comment = demoWorkItemComment(input?.markdown);
      return { ...comment, id: input?.commentId ?? comment.id };
    }
    case "update_work_item_fields": {
      const input = (args as { input?: UpdateWorkItemFieldsInput } | undefined)?.input;
      return demoUpdateWorkItemFields(input);
    }
    case "list_work_item_updates":
      return demoWorkItemUpdates();
    case "list_work_item_field_allowed_values": {
      const input = (
        args as { input?: ListWorkItemFieldAllowedValuesInput } | undefined
      )?.input;
      return demoListWorkItemFieldAllowedValues(input);
    }
    case "list_work_item_type_states": {
      const input = (args as { input?: ListWorkItemTypeStatesInput } | undefined)
        ?.input;
      return demoListWorkItemTypeStates(input);
    }
    case "list_work_item_fields": {
      const input = (args as { input?: ListWorkItemFieldsInput } | undefined)?.input;
      return demoListWorkItemFields(input);
    }
    case "set_work_items_state": {
      const input = (args as { input?: SetWorkItemsStateInput } | undefined)?.input;
      return (input?.workItemIds ?? []).map((id) => ({ id, error: null }));
    }
    case "assign_work_items": {
      const input = (args as { input?: AssignWorkItemsInput } | undefined)?.input;
      return (input?.workItemIds ?? []).map((id) => ({ id, error: null }));
    }
    case "set_work_items_priority": {
      const input = (args as { input?: SetWorkItemsPriorityInput } | undefined)?.input;
      return (input?.workItemIds ?? []).map((id) => ({ id, error: null }));
    }
    case "search_commits": {
      const input = (args as { input?: SearchCommitsInput } | undefined)
        ?.input;
      return demoCommits(input);
    }
    case "commit_activity": {
      const input = (args as { input?: CommitActivityInput } | undefined)?.input;
      return demoCommitActivity(input);
    }
    case "list_commit_repositories":
      return demoCommitRepositories();
    case "get_commit_changes": {
      const input = (args as { input?: { commitId?: string } } | undefined)?.input;
      return {
        commitId: input?.commitId ?? "demosha",
        parentCommitId: "demoparent",
        files: [
          { path: "/src/app.ts", changeType: "edit", originalPath: null },
          { path: "/README.md", changeType: "add", originalPath: null },
        ],
      };
    }
    case "get_commit_file_diff": {
      const input = (args as { input?: { filePath?: string } } | undefined)?.input;
      return {
        filePath: input?.filePath ?? "/src/app.ts",
        baseContent: "const x = 1;\nconst y = 2;\n",
        targetContent: "const x = 1;\nconst y = 3;\nconst z = 4;\n",
        baseUnavailableReason: null,
        targetUnavailableReason: null,
      };
    }
    case "get_commit_pull_requests": {
      const input = (args as { input?: { commitId?: string } } | undefined)?.input;
      return demoCommitPullRequests(input?.commitId);
    }
    case "cancel_operation":
      // Demo searches resolve instantly, so there is nothing to cancel.
      return null;
    case "search_code": {
      const input = (args as { input?: { query?: string } } | undefined)?.input;
      const query = input?.query?.trim() ?? "";
      if (!query) return { count: 0, results: [], notice: null };
      return {
        // The Search API reports total matches, which can exceed the returned
        // results (the backend caps results at 50). Mirror that here.
        count: 137,
        notice: null,
        results: [
          {
            fileName: "azdoCommands.ts",
            path: "/src/lib/azdoCommands.ts",
            projectName: "Demo Project",
            repositoryName: "azdo-dashboard",
            branch: "main",
            webUrl:
              "https://dev.azure.com/demo/Demo%20Project/_git/azdo-dashboard?path=/src/lib/azdoCommands.ts&_a=contents&version=GBmain",
          },
          {
            fileName: "App.tsx",
            path: "/src/App.tsx",
            projectName: "Demo Project",
            repositoryName: "azdo-dashboard",
            branch: "main",
            webUrl:
              "https://dev.azure.com/demo/Demo%20Project/_git/azdo-dashboard?path=/src/App.tsx&_a=contents&version=GBmain",
          },
        ],
      };
    }
    case "list_pipeline_projects":
      return demoPipelineProjects();
    case "list_pipeline_definitions":
      return demoPipelineDefinitions();
    case "list_pipeline_runs":
      return demoPipelineRuns();
    case "get_pipeline_run": {
      const input = (args as { input?: { buildId?: number } } | undefined)?.input;
      return demoPipelineRunDetail(input?.buildId ?? 1001);
    }
    case "get_pipeline_run_log_tail":
      return {
        lines: ["[command] npm run build", "ERROR: build failed (exit 1)"],
        truncated: false,
      };
    case "rerun_pipeline_run": {
      const input = (args as { input?: { buildId?: number } } | undefined)?.input;
      return {
        ...demoPipelineRuns()[0],
        buildId: input?.buildId ?? 1004,
        status: "notStarted",
        result: null,
      };
    }
    case "cancel_pipeline_run": {
      const input = (args as { input?: { buildId?: number } } | undefined)?.input;
      const run =
        demoPipelineRuns().find((r) => r.buildId === input?.buildId) ??
        demoPipelineRuns()[2];
      return { ...run, status: "cancelling" };
    }
    case "list_sync_states":
      return demoSyncStates;
    case "snooze_item": {
      const input = (
        args as
          | { input?: { itemType: string; itemKey: string; snoozeUntil: string } }
          | undefined
      )?.input;
      if (input) {
        demoSnoozes.set(
          demoSnoozeStoreKey(input.itemType, input.itemKey),
          input.snoozeUntil,
        );
      }
      return null;
    }
    case "unsnooze_item": {
      const input = (
        args as { input?: { itemType: string; itemKey: string } } | undefined
      )?.input;
      if (input) {
        demoSnoozes.delete(demoSnoozeStoreKey(input.itemType, input.itemKey));
      }
      return null;
    }
    case "list_snoozed_items": {
      const input = (args as { input?: { itemType: string } } | undefined)?.input;
      return demoListSnoozedItems(input?.itemType ?? "");
    }
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
    case "record_mention_interaction":
    case "record_assignee_interaction":
      return null;
    case "trigger_sync":
      demoSyncStates = demoSyncStates.map((state) => ({
        ...state,
        lastSyncedAt: new Date().toISOString(),
        errorCount: 0,
        lastError: null,
        lastWarning: null,
      }));
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

  return applyPullRequestScenario(all).filter((pr) => {
    if (input?.projectId && pr.projectId !== input.projectId) return false;
    if (input?.repositoryId && pr.repositoryId !== input.repositoryId) return false;
    if (statusFilter !== "all" && pr.status !== statusFilter) return false;
    if (query) {
      const textMatch = [pr.title, pr.projectName, pr.repositoryName, pr.createdBy ?? "", pr.sourceRefName, pr.targetRefName].some(
        (v) => v.toLowerCase().includes(query),
      );
      const idMatch = /^\d+$/.test(query) && String(pr.pullRequestId).startsWith(query);
      if (!textMatch && !idMatch) return false;
    }
    return true;
  });
}

function withEmptyExtraFields(
  items: Omit<WorkItemSummary, "extraFields" | "depth">[],
): WorkItemSummary[] {
  return items.map((item) => ({ ...item, extraFields: [], depth: null }));
}

function demoWorkItems(input?: SearchWorkItemsInput): WorkItemSummary[] {
  const all: Omit<WorkItemSummary, "extraFields" | "depth">[] = [
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

  return applyWorkItemScenario(withEmptyExtraFields(all)).filter((item) => {
    if (input?.projectId && item.projectId !== input.projectId) return false;
    if (stateFilter && item.state !== stateFilter) return false;
    if (typeFilter && item.workItemType !== typeFilter) return false;
    if (query) {
      const textMatch = [item.title, item.projectName, item.workItemType ?? "", item.state ?? "", item.assignedTo ?? ""].some(
        (v) => v.toLowerCase().includes(query),
      );
      const idMatch = /^\d+$/.test(query) && String(item.id).startsWith(query);
      if (!textMatch && !idMatch) return false;
    }
    return true;
  });
}

function demoMyWorkItems(): WorkItemSummary[] {
  return applyWorkItemScenario(withEmptyExtraFields([
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
  ]));
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

  const extraFields = input?.extraFields ?? [];
  const isLinkQuery = /\bfrom\s+workitemlinks\b/.test(wiql);
  return results.slice(0, input?.limit ?? 200).map((item, index) => ({
    ...item,
    extraFields: extraFields.map((referenceName) => ({
      referenceName,
      value: demoExtraFieldValue(referenceName, item),
    })),
    depth: isLinkQuery ? (index % 3 === 0 ? 0 : 1) : null,
  }));
}

function demoExtraFieldValue(referenceName: string, item: WorkItemSummary): string | null {
  const lower = referenceName.toLowerCase();
  if (lower.endsWith(".priority")) return String((item.id % 4) + 1);
  if (lower.endsWith(".storypoints")) return String((item.id % 8) + 1);
  if (lower.endsWith(".severity")) return `${(item.id % 4) + 1} - Medium`;
  if (lower === "system.areapath") return item.projectName;
  if (lower === "system.iterationpath") return `${item.projectName}\\Sprint ${(item.id % 3) + 1}`;
  return null;
}

function demoWorkItemPreview(input?: GetWorkItemPreviewInput): WorkItemPreview {
  const allItems = [...demoWorkItems(), ...demoMyWorkItems()];
  const summary =
    allItems.find(
      (item) =>
        item.id === input?.workItemId &&
        (!input?.projectId || item.projectId === input.projectId),
    ) ?? allItems[0];

  return applyWorkItemPreviewScenario({
    organizationId: summary.organizationId,
    projectId: summary.projectId,
    projectName: summary.projectName,
    id: summary.id,
    title: summary.title,
    workItemType: summary.workItemType,
    state: summary.state,
    assignedTo: summary.assignedTo,
    assignedToUniqueName: summary.assignedTo
      ? `${summary.assignedTo.split(" ")[0]!.toLowerCase()}@example.com`
      : null,
    createdBy: "Demo User",
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
    customFields: (input?.customFields ?? []).map((referenceName, index) => ({
      referenceName,
      value:
        referenceName === "Custom.ReleaseTrain"
          ? "Tokyo"
          : referenceName === "Custom.CustomerImpact"
            ? "High"
            : `Demo value ${index + 1}`,
    })),
    webUrl: summary.webUrl,
    commentsUnavailable: false,
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
    relations: [
      {
        relationType: "Parent",
        id: 90,
        title: "Improve dashboard operations experience",
        state: "Active",
        workItemType: "Feature",
        webUrl: `https://dev.azure.com/contoso/${encodeURIComponent(summary.projectName)}/_workitems/edit/90`,
      },
      {
        relationType: "Child",
        id: summary.id + 1000,
        title: `Subtask for ${summary.title}`,
        state: "New",
        workItemType: "Task",
        webUrl: `https://dev.azure.com/contoso/${encodeURIComponent(summary.projectName)}/_workitems/edit/${summary.id + 1000}`,
      },
      {
        relationType: "Related",
        id: 77,
        title: "Track API rate limits in client retries",
        state: "Closed",
        workItemType: "Bug",
        webUrl: `https://dev.azure.com/contoso/${encodeURIComponent(summary.projectName)}/_workitems/edit/77`,
      },
    ],
    pullRequests: [
      {
        pullRequestId: 101,
        repositoryId: "api-gateway",
        title: "Add rate limiter to API gateway",
        status: "Active",
        myVoteLabel: "No Vote",
        webUrl: "https://dev.azure.com/contoso/demo-project/_git/api-gateway/pullrequest/101",
      },
      {
        pullRequestId: 9001,
        repositoryId: null,
        title: null,
        status: null,
        myVoteLabel: null,
        webUrl: null,
      },
    ],
    attachments: [
      {
        name: "repro-steps.png",
        url: "https://dev.azure.com/contoso/_apis/wit/attachments/demo-attachment-1",
      },
      {
        name: "diagnostics.log",
        url: "https://dev.azure.com/contoso/_apis/wit/attachments/demo-attachment-2",
      },
    ],
  });
}

function demoUpdateWorkItemFields(input?: UpdateWorkItemFieldsInput): WorkItemPreview {
  let preview = demoWorkItemPreview(
    input
      ? { organizationId: input.organizationId, projectId: input.projectId, workItemId: input.workItemId }
      : undefined,
  );
  for (const field of input?.fields ?? []) {
    const referenceName = field.referenceName.trim();
    const value = field.value.trim();
    if (referenceName === "System.State" && value) preview = { ...preview, state: value };
    else if (referenceName === "System.Reason" && value) preview = { ...preview, reason: value };
    else if (referenceName === "System.AssignedTo") preview = { ...preview, assignedTo: value || null };
    else if (referenceName === "System.Tags") preview = { ...preview, tags: value || null };
    else if (referenceName === "Microsoft.VSTS.Common.Priority" && value) preview = { ...preview, priority: value };
    else if (referenceName) {
      const others = preview.customFields.filter(
        (existing) => existing.referenceName.toLowerCase() !== referenceName.toLowerCase(),
      );
      preview = { ...preview, customFields: [...others, { referenceName, value }] };
    }
  }
  return { ...preview, changedDate: new Date().toISOString() };
}

function demoListWorkItemFieldAllowedValues(
  input?: ListWorkItemFieldAllowedValuesInput,
): string[] {
  if (input?.fieldReferenceName === "Custom.CustomerImpact") {
    return ["Low", "Medium", "High"];
  }
  if (input?.fieldReferenceName === "Custom.ReleaseTrain") {
    return ["Tokyo", "Osaka", "Nagoya"];
  }
  return [];
}

function demoWorkItemUpdates(): WorkItemUpdateSummary[] {
  return [
    {
      id: 3,
      revisedBy: "Alice Johnson",
      revisedDate: "2026-05-27T14:30:00Z",
      changes: [
        { referenceName: "System.State", oldValue: "New", newValue: "Active" },
        { referenceName: "System.Reason", oldValue: "New", newValue: "Work started" },
      ],
    },
    {
      id: 2,
      revisedBy: "Demo User",
      revisedDate: "2026-05-26T10:15:00Z",
      changes: [
        {
          referenceName: "System.AssignedTo",
          oldValue: null,
          newValue: "Demo User",
        },
        {
          referenceName: "Microsoft.VSTS.Common.Priority",
          oldValue: "3",
          newValue: "2",
        },
      ],
    },
    {
      id: 1,
      revisedBy: "Demo User",
      revisedDate: "2026-05-20T09:00:00Z",
      changes: [
        { referenceName: "System.Title", oldValue: null, newValue: "Created" },
      ],
    },
  ];
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

function demoListWorkItemFields(_input?: ListWorkItemFieldsInput): WorkItemFieldOption[] {
  return [
    { name: "Release Train", referenceName: "Custom.ReleaseTrain", fieldType: "string", custom: true },
    { name: "Customer Impact", referenceName: "Custom.CustomerImpact", fieldType: "string", custom: true },
    { name: "Escalation", referenceName: "Custom.Escalation", fieldType: "boolean", custom: true },
    { name: "Priority", referenceName: "Microsoft.VSTS.Common.Priority", fieldType: "integer", custom: false },
    { name: "Severity", referenceName: "Microsoft.VSTS.Common.Severity", fieldType: "string", custom: false },
    { name: "Story Points", referenceName: "Microsoft.VSTS.Scheduling.StoryPoints", fieldType: "double", custom: false },
  ];
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

const demoAssigneePeople: WorkItemAssigneeCandidate[] = demoMentionPeople.map(
  (person) => ({
    ...person,
    assignValue: person.uniqueName
      ? `${person.displayName} <${person.uniqueName}>`
      : person.displayName,
  }),
);

function demoMentionCandidates(query?: string): MentionCandidate[] {
  const term = query?.trim().toLowerCase() ?? "";
  if (!term) return demoMentionPeople;
  return demoMentionPeople.filter(
    (person) =>
      person.displayName.toLowerCase().includes(term) ||
      person.uniqueName?.toLowerCase().includes(term),
  );
}

function demoAssigneeCandidates(query?: string): WorkItemAssigneeCandidate[] {
  const term = query?.trim().toLowerCase() ?? "";
  if (!term) return demoAssigneePeople;
  return demoAssigneePeople.filter(
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

function demoListSnoozedItems(itemType: string): SnoozedItemSummary[] {
  const snoozedKeys = demoSnoozedKeys(itemType);
  if (itemType === "pull_request") {
    return demoReviewPullRequests()
      .filter((pr) => snoozedKeys.has(`${pr.repositoryId}:${pr.pullRequestId}`))
      .map((pr) => ({
        itemType,
        itemKey: `${pr.repositoryId}:${pr.pullRequestId}`,
        snoozeUntil:
          demoSnoozes.get(
            demoSnoozeStoreKey(itemType, `${pr.repositoryId}:${pr.pullRequestId}`),
          ) ?? "",
        title: pr.title,
        subtitle: pr.repositoryName,
        webUrl: pr.webUrl,
      }));
  }
  return demoMyWorkItems()
    .filter((item) => snoozedKeys.has(String(item.id)))
    .map((item) => ({
      itemType,
      itemKey: String(item.id),
      snoozeUntil:
        demoSnoozes.get(demoSnoozeStoreKey(itemType, String(item.id))) ?? "",
      title: item.title,
      subtitle: item.state ?? null,
      webUrl: item.webUrl ?? null,
    }));
}

function demoReviewPullRequests(): ReviewPullRequestSummary[] {
  const now = new Date("2026-05-24T08:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const min = 60_000;
  const hr = 3_600_000;
  const day = 86_400_000;

  return withDemoVotes(applyReviewPullRequestScenario([
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
      mergeStatus: "conflicts",
      ciStatus: "failed",
      ciContext: "ci-build",
      ciCheckCount: 3,
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
      mergeStatus: null,
      ciStatus: "succeeded",
      ciContext: "ci-build",
      ciCheckCount: 2,
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
      mergeStatus: null,
      ciStatus: "in_progress",
      ciContext: "ios-build",
      ciCheckCount: 1,
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
      mergeStatus: null,
      ciStatus: null,
      ciContext: null,
      ciCheckCount: 0,
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
      mergeStatus: null,
      ciStatus: "failed",
      ciContext: "terraform-validate",
      ciCheckCount: 2,
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
      mergeStatus: null,
      ciStatus: null,
      ciContext: null,
      ciCheckCount: 0,
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
      mergeStatus: null,
      ciStatus: "succeeded",
      ciContext: "ci-build",
      ciCheckCount: 4,
    },
  ]));
}

// Reflects votes cast through submit_pull_request_vote in the demo session.
function withDemoVotes(prs: ReviewPullRequestSummary[]): ReviewPullRequestSummary[] {
  if (demoPrVotes.size === 0) return prs;
  return prs.map((pr) => {
    const vote = demoPrVotes.get(pr.pullRequestId);
    if (vote == null) return pr;
    return { ...pr, myVote: vote, myVoteLabel: demoVoteLabel(vote) };
  });
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

// Demo commit → PR relationships. Only a couple of commits map to PRs so the
// "no related PRs" path stays exercised for the rest.
function demoCommitPullRequests(commitId?: string): CommitPullRequest[] {
  const map: Record<string, CommitPullRequest[]> = {
    abcdef1234567890abcdef1234567890abcdef12: [
      {
        pullRequestId: 4242,
        repositoryId: "azdo-dashboard",
        title: "Add commit search dashboard",
        status: "completed",
        myVote: 10,
        myVoteLabel: "Approved",
        webUrl:
          "https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/pullrequest/4242",
      },
    ],
    cafe5678901234567890abcdef1234567890cafe: [
      {
        pullRequestId: 4310,
        repositoryId: "api-gateway",
        title: "Fix Retry-After header parsing",
        status: "active",
        myVote: 0,
        myVoteLabel: "No Vote",
        webUrl:
          "https://dev.azure.com/contoso/Platform/_git/api-gateway/pullrequest/4310",
      },
      {
        pullRequestId: 4288,
        repositoryId: "api-gateway",
        title: "Rate limiting hardening",
        status: "abandoned",
        myVote: -5,
        myVoteLabel: "Waiting for Author",
        webUrl:
          "https://dev.azure.com/contoso/Platform/_git/api-gateway/pullrequest/4288",
      },
    ],
  };
  return commitId ? map[commitId] ?? [] : [];
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

  // Mirror the backend contract: branch-scoped search needs a repository
  // because it queries that repository's branch live instead of the cache.
  if (input?.branch?.trim() && !input?.repositoryId) {
    throw new Error("select a repository to search a specific branch");
  }

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

function demoCommitActivity(input?: CommitActivityInput): CommitActivityDay[] {
  // Synthesize a deterministic, GitHub-style cadence over the requested window
  // (defaulting to the last 90 days) so the browser demo shows a populated
  // heatmap. Filters narrow the volume to mimic per-author / per-repo activity.
  const end = input?.toDate ? new Date(`${input.toDate}T00:00:00Z`) : new Date();
  const start = input?.fromDate
    ? new Date(`${input.fromDate}T00:00:00Z`)
    : new Date(end.getTime() - 89 * 86_400_000);
  if (start > end) return [];

  const narrowed = (input?.author?.trim() ? 1 : 0) + (input?.repositoryId ? 1 : 0);
  const scale = narrowed >= 2 ? 0.3 : narrowed === 1 ? 0.55 : 1;

  const days: CommitActivityDay[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= endDay) {
    const date = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
    const dow = cursor.getUTCDay();
    // Deterministic pseudo-random based on the date string.
    let seed = 0;
    for (const ch of date) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const base = seed % 7; // 0..6
    const weekendDamping = dow === 0 || dow === 6 ? 0.25 : 1;
    const count = Math.round(base * weekendDamping * scale);
    if (count > 0) days.push({ date, count });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
