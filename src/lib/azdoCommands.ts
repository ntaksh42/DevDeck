import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { isTauriRuntime } from "@/lib/runtime";
import { demoInvoke } from "@/lib/azdoDemo";

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
  showWindowHotkey: z.string().nullable().default(null),
  readOnlyValidationModeEnabled: z.boolean().default(false),
  desktopNotificationsEnabled: z.boolean().default(false),
  notificationContentPreviewEnabled: z.boolean().default(true),
  notifyWorkItemAssignments: z.boolean().default(true),
  notifyWorkItemStateChanges: z.boolean().default(true),
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

const workItemFieldOptionSchema = z.object({
  name: z.string(),
  referenceName: z.string(),
  fieldType: z.string(),
  custom: z.boolean(),
});

const workItemFieldOptionsSchema = z.array(workItemFieldOptionSchema);

export type WorkItemFieldOption = z.infer<typeof workItemFieldOptionSchema>;

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

const workItemCustomFieldSchema = z.object({
  referenceName: z.string(),
  value: z.string().nullable(),
});

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
  customFields: z.array(workItemCustomFieldSchema).default([]),
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

const workItemAssigneeCandidateSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  uniqueName: z.string().nullable(),
  assignValue: z.string(),
});

const workItemAssigneeCandidatesSchema = z.array(workItemAssigneeCandidateSchema);

export type WorkItemAssigneeCandidate = z.infer<typeof workItemAssigneeCandidateSchema>;

const savedQueryResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  wiql: z.string().nullish(),
});

export type SavedQueryResult = z.infer<typeof savedQueryResultSchema>;

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

const syncScopeSchema = z.enum(["all", "hot", "myReviews", "myWorkItems", "commits"]);

export type SyncScope = z.infer<typeof syncScopeSchema>;

const syncStateSchema = z.object({
  scope: z.string(),
  orgId: z.string(),
  lastSyncedAt: z.string().nullable(),
  errorCount: z.number(),
  lastError: z.string().nullable(),
});

const syncStatesSchema = z.array(syncStateSchema);

export type SyncState = z.infer<typeof syncStateSchema>;

export const syncUpdatedEventSchema = z.object({
  orgId: z.string(),
  scopes: z.array(syncScopeSchema),
});

export type SyncUpdatedEvent = z.infer<typeof syncUpdatedEventSchema>;

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
  showWindowHotkey?: string | null;
  readOnlyValidationModeEnabled?: boolean;
  desktopNotificationsEnabled?: boolean;
  notificationContentPreviewEnabled?: boolean;
  notifyWorkItemAssignments?: boolean;
  notifyWorkItemStateChanges?: boolean;
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
  customFields?: string[];
};

export type SearchWorkItemMentionsInput = {
  organizationId?: string;
  query: string;
};

export type RecordMentionInteractionInput = {
  organizationId?: string;
  userId?: string;
  displayName: string;
  uniqueName: string;
};

export type SearchWorkItemAssigneesInput = {
  organizationId?: string;
  projectId: string;
  workItemId: number;
  query: string;
};

export type FetchWorkItemImageInput = {
  organizationId?: string;
  url: string;
};

export type AddWorkItemCommentInput = {
  organizationId?: string;
  projectId: string;
  workItemId: number;
  markdown: string;
};

export type DeleteWorkItemCommentInput = {
  organizationId?: string;
  projectId: string;
  workItemId: number;
  commentId: number;
};

export type AssignWorkItemInput = {
  organizationId?: string;
  projectId: string;
  workItemId: number;
  assignedTo: string;
};

export type SetWorkItemStateInput = {
  organizationId?: string;
  projectId: string;
  workItemId: number;
  state: string;
};

export type SetWorkItemReasonInput = {
  organizationId?: string;
  projectId: string;
  workItemId: number;
  reason: string;
};

export type SetWorkItemPriorityInput = {
  organizationId?: string;
  projectId: string;
  workItemId: number;
  priority: number;
};

export type ListWorkItemTypeStatesInput = {
  organizationId?: string;
  projectId: string;
  workItemType: string;
};

export type ListWorkItemFieldsInput = {
  organizationId?: string;
  projectId: string;
};

export type BulkWorkItemResult = {
  id: number;
  error: string | null;
};

const bulkWorkItemResultSchema = z.object({
  id: z.number(),
  error: z.string().nullable(),
});
const bulkWorkItemResultsSchema = z.array(bulkWorkItemResultSchema);

export type SetWorkItemsStateInput = {
  organizationId?: string;
  projectId: string;
  workItemIds: number[];
  state: string;
};

export type AssignWorkItemsInput = {
  organizationId?: string;
  projectId: string;
  workItemIds: number[];
  assignedTo: string;
};

export type SetWorkItemsPriorityInput = {
  organizationId?: string;
  projectId: string;
  workItemIds: number[];
  priority: number;
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

export type GetSavedQueryInput = {
  organizationId?: string;
  projectId: string;
  queryId: string;
};

export type ListCommitRepositoriesInput = {
  organizationId?: string;
};

export type TriggerSyncInput = {
  scope?: SyncScope;
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

export async function countWorkItemQuery(
  input: RunWorkItemQueryInput,
): Promise<number> {
  const result = await invokeCommand("count_work_item_query", { input });
  return z.number().parse(result);
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

export async function recordMentionInteraction(
  input: RecordMentionInteractionInput,
): Promise<void> {
  await invokeCommand("record_mention_interaction", { input });
}

export async function searchWorkItemAssignees(
  input: SearchWorkItemAssigneesInput,
): Promise<WorkItemAssigneeCandidate[]> {
  const result = await invokeCommand("search_work_item_assignees", { input });
  return workItemAssigneeCandidatesSchema.parse(result);
}

const workItemImageSchema = z.object({
  dataUrl: z.string(),
});

export async function fetchWorkItemImage(
  input: FetchWorkItemImageInput,
): Promise<string> {
  const result = await invokeCommand("fetch_work_item_image", { input });
  return workItemImageSchema.parse(result).dataUrl;
}

export async function addWorkItemComment(
  input: AddWorkItemCommentInput,
): Promise<WorkItemComment> {
  const result = await invokeCommand("add_work_item_comment", { input });
  return workItemCommentSchema.parse(result);
}

export async function deleteWorkItemComment(
  input: DeleteWorkItemCommentInput,
): Promise<void> {
  await invokeCommand("delete_work_item_comment", { input });
}

export async function assignWorkItem(
  input: AssignWorkItemInput,
): Promise<WorkItemPreview> {
  const result = await invokeCommand("assign_work_item", { input });
  return workItemPreviewSchema.parse(result);
}

export async function setWorkItemState(
  input: SetWorkItemStateInput,
): Promise<WorkItemPreview> {
  const result = await invokeCommand("set_work_item_state", { input });
  return workItemPreviewSchema.parse(result);
}

export async function setWorkItemReason(
  input: SetWorkItemReasonInput,
): Promise<WorkItemPreview> {
  const result = await invokeCommand("set_work_item_reason", { input });
  return workItemPreviewSchema.parse(result);
}

export async function setWorkItemPriority(
  input: SetWorkItemPriorityInput,
): Promise<WorkItemPreview> {
  const result = await invokeCommand("set_work_item_priority", { input });
  return workItemPreviewSchema.parse(result);
}

export async function listWorkItemTypeStates(
  input: ListWorkItemTypeStatesInput,
): Promise<string[]> {
  const result = await invokeCommand("list_work_item_type_states", { input });
  return z.array(z.string()).parse(result);
}

export async function listWorkItemFields(
  input: ListWorkItemFieldsInput,
): Promise<WorkItemFieldOption[]> {
  const result = await invokeCommand("list_work_item_fields", { input });
  return workItemFieldOptionsSchema.parse(result);
}

export async function setWorkItemsState(
  input: SetWorkItemsStateInput,
): Promise<BulkWorkItemResult[]> {
  const result = await invokeCommand("set_work_items_state", { input });
  return bulkWorkItemResultsSchema.parse(result);
}

export async function assignWorkItems(
  input: AssignWorkItemsInput,
): Promise<BulkWorkItemResult[]> {
  const result = await invokeCommand("assign_work_items", { input });
  return bulkWorkItemResultsSchema.parse(result);
}

export async function setWorkItemsPriority(
  input: SetWorkItemsPriorityInput,
): Promise<BulkWorkItemResult[]> {
  const result = await invokeCommand("set_work_items_priority", { input });
  return bulkWorkItemResultsSchema.parse(result);
}

export async function getSavedQuery(
  input: GetSavedQueryInput,
): Promise<SavedQueryResult> {
  const result = await invokeCommand("get_saved_query", { input });
  return savedQueryResultSchema.parse(result);
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

export async function listSyncStates(): Promise<SyncState[]> {
  const result = await invokeCommand("list_sync_states");
  return syncStatesSchema.parse(result);
}

export async function triggerSync(input: TriggerSyncInput = {}): Promise<void> {
  await invokeCommand("trigger_sync", { input });
}

async function invokeCommand(command: string, args?: unknown): Promise<unknown> {
  if (isTauriRuntime()) {
    return invoke(command, args as Record<string, unknown> | undefined);
  }

  return demoInvoke(command, args);
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
