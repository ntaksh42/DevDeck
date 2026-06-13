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
  authenticatedUserUniqueName: z.string().nullish(),
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
  mergeStatus: z.string().nullable().default(null),
});

const reviewPullRequestSummariesSchema = z.array(reviewPullRequestSummarySchema);

export type ReviewPullRequestSummary = z.infer<typeof reviewPullRequestSummarySchema>;

const prReviewerSchema = z.object({
  displayName: z.string(),
  vote: z.number(),
  voteLabel: z.string(),
  isRequired: z.boolean(),
  isMe: z.boolean(),
});

export type PrReviewer = z.infer<typeof prReviewerSchema>;

const prCommentSchema = z.object({
  id: z.number(),
  parentCommentId: z.number().nullable(),
  content: z.string().nullable(),
  author: z.string().nullable(),
  publishedDate: z.string().nullable(),
  isSystem: z.boolean(),
});

export type PrComment = z.infer<typeof prCommentSchema>;

const prThreadSchema = z.object({
  id: z.number(),
  status: z.string().nullable(),
  filePath: z.string().nullable(),
  rightLine: z.number().nullable(),
  comments: z.array(prCommentSchema),
});

export type PrThread = z.infer<typeof prThreadSchema>;

const pullRequestReviewSchema = z.object({
  pullRequestId: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  sourceRefName: z.string(),
  targetRefName: z.string(),
  createdBy: z.string().nullable(),
  creationDate: z.string().nullable(),
  isDraft: z.boolean(),
  reviewers: z.array(prReviewerSchema),
  threads: z.array(prThreadSchema),
});

export type PullRequestReview = z.infer<typeof pullRequestReviewSchema>;

const prChangedFileSchema = z.object({
  path: z.string(),
  changeType: z.string(),
  originalPath: z.string().nullable(),
});

export type PrChangedFile = z.infer<typeof prChangedFileSchema>;

const pullRequestChangesSchema = z.object({
  baseCommitId: z.string().nullable(),
  targetCommitId: z.string().nullable(),
  files: z.array(prChangedFileSchema),
});

export type PullRequestChanges = z.infer<typeof pullRequestChangesSchema>;

const prFileDiffSchema = z.object({
  filePath: z.string(),
  baseContent: z.string().nullable(),
  targetContent: z.string().nullable(),
  baseUnavailableReason: z.string().nullable(),
  targetUnavailableReason: z.string().nullable(),
});

export type PrFileDiff = z.infer<typeof prFileDiffSchema>;

const workItemSummaryExtraFieldSchema = z.object({
  referenceName: z.string(),
  value: z.string().nullable(),
});

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
  extraFields: z.array(workItemSummaryExtraFieldSchema).default([]),
  depth: z.number().nullable().default(null),
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

const workItemRelationSchema = z.object({
  relationType: z.string(),
  id: z.number(),
  title: z.string().nullable(),
  state: z.string().nullable(),
  workItemType: z.string().nullable(),
  webUrl: z.string().nullable(),
});

export type WorkItemRelation = z.infer<typeof workItemRelationSchema>;

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
  relations: z.array(workItemRelationSchema).default([]),
});

export type WorkItemPreview = z.infer<typeof workItemPreviewSchema>;

const workItemFieldChangeSchema = z.object({
  referenceName: z.string(),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
});

const workItemUpdateSummarySchema = z.object({
  id: z.number(),
  revisedBy: z.string().nullable(),
  revisedDate: z.string().nullable(),
  changes: z.array(workItemFieldChangeSchema),
});

const workItemUpdateSummariesSchema = z.array(workItemUpdateSummarySchema);

export type WorkItemUpdateSummary = z.infer<typeof workItemUpdateSummarySchema>;

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

const searchAllResultSchema = z.object({
  workItems: workItemSummariesSchema,
  pullRequests: pullRequestSummariesSchema,
  commits: commitSummariesSchema,
  totals: z.object({
    workItems: z.number(),
    pullRequests: z.number(),
    commits: z.number(),
  }),
});

export type SearchAllResult = z.infer<typeof searchAllResultSchema>;

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
  lastWarning: z.string().nullable().default(null),
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

export type PrLocatorInput = {
  organizationId?: string;
  projectId: string;
  repositoryId: string;
  pullRequestId: number;
};

export type GetPullRequestReviewInput = PrLocatorInput;
export type ListPullRequestChangesInput = PrLocatorInput;

export type GetPullRequestFileDiffInput = PrLocatorInput & {
  filePath: string;
  originalPath?: string | null;
  changeType: string;
  baseCommitId?: string | null;
  targetCommitId?: string | null;
};

export type PostPullRequestCommentInput = PrLocatorInput & {
  threadId?: number;
  parentCommentId?: number;
  content: string;
  filePath?: string;
  rightLine?: number;
};

export type SetPullRequestThreadStatusInput = PrLocatorInput & {
  threadId: number;
  status: "active" | "closed";
};

export type SubmitPullRequestVoteInput = PrLocatorInput & {
  vote: -10 | -5 | 0 | 5 | 10;
};

export type SearchAllInput = {
  organizationId?: string;
  query: string;
  limitPerKind?: number;
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
  extraFields?: string[];
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
  projectId: string;
  workItemId: number;
  query: string;
};

export type RecordMentionInteractionInput = {
  organizationId?: string;
  userId?: string;
  displayName: string;
  uniqueName: string;
};

export type RecordAssigneeInteractionInput = RecordMentionInteractionInput;

export type SearchWorkItemAssigneesInput = {
  organizationId?: string;
  projectId: string;
  workItemId: number;
  query: string;
};

export type SetWorkItemFieldInput = {
  organizationId?: string;
  projectId: string;
  workItemId: number;
  fieldReferenceName: string;
  value: string;
};

export type WorkItemFieldValueInput = {
  referenceName: string;
  value: string;
};

export type UpdateWorkItemFieldsInput = {
  organizationId?: string;
  projectId: string;
  workItemId: number;
  fields: WorkItemFieldValueInput[];
};

export type SetWorkItemTagsInput = {
  organizationId?: string;
  projectId: string;
  workItemId: number;
  tags: string[];
};

export type ListWorkItemUpdatesInput = {
  organizationId?: string;
  projectId: string;
  workItemId: number;
};

export type ListWorkItemFieldAllowedValuesInput = {
  organizationId?: string;
  projectId: string;
  workItemType: string;
  fieldReferenceName: string;
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

export async function getPullRequestReview(
  input: GetPullRequestReviewInput,
): Promise<PullRequestReview> {
  const result = await invokeCommand("get_pull_request_review", { input });
  return pullRequestReviewSchema.parse(result);
}

export async function listPullRequestChanges(
  input: ListPullRequestChangesInput,
): Promise<PullRequestChanges> {
  const result = await invokeCommand("list_pull_request_changes", { input });
  return pullRequestChangesSchema.parse(result);
}

export async function getPullRequestFileDiff(
  input: GetPullRequestFileDiffInput,
): Promise<PrFileDiff> {
  const result = await invokeCommand("get_pull_request_file_diff", { input });
  return prFileDiffSchema.parse(result);
}

export async function postPullRequestComment(
  input: PostPullRequestCommentInput,
): Promise<PrThread> {
  const result = await invokeCommand("post_pull_request_comment", { input });
  return prThreadSchema.parse(result);
}

export async function setPullRequestThreadStatus(
  input: SetPullRequestThreadStatusInput,
): Promise<PrThread> {
  const result = await invokeCommand("set_pull_request_thread_status", { input });
  return prThreadSchema.parse(result);
}

export async function submitPullRequestVote(
  input: SubmitPullRequestVoteInput,
): Promise<PrReviewer> {
  const result = await invokeCommand("submit_pull_request_vote", { input });
  return prReviewerSchema.parse(result);
}

export async function searchAll(input: SearchAllInput): Promise<SearchAllResult> {
  const result = await invokeCommand("search_all", { input });
  return searchAllResultSchema.parse(result);
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

export async function recordAssigneeInteraction(
  input: RecordAssigneeInteractionInput,
): Promise<void> {
  await invokeCommand("record_assignee_interaction", { input });
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

export async function setWorkItemField(
  input: SetWorkItemFieldInput,
): Promise<WorkItemPreview> {
  const result = await invokeCommand("set_work_item_field", { input });
  return workItemPreviewSchema.parse(result);
}

export async function updateWorkItemFields(
  input: UpdateWorkItemFieldsInput,
): Promise<WorkItemPreview> {
  const result = await invokeCommand("update_work_item_fields", { input });
  return workItemPreviewSchema.parse(result);
}

export async function setWorkItemTags(
  input: SetWorkItemTagsInput,
): Promise<WorkItemPreview> {
  const result = await invokeCommand("set_work_item_tags", { input });
  return workItemPreviewSchema.parse(result);
}

export async function listWorkItemUpdates(
  input: ListWorkItemUpdatesInput,
): Promise<WorkItemUpdateSummary[]> {
  const result = await invokeCommand("list_work_item_updates", { input });
  return workItemUpdateSummariesSchema.parse(result);
}

export async function listWorkItemFieldAllowedValues(
  input: ListWorkItemFieldAllowedValuesInput,
): Promise<string[]> {
  const result = await invokeCommand("list_work_item_field_allowed_values", {
    input,
  });
  return z.array(z.string()).parse(result);
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
