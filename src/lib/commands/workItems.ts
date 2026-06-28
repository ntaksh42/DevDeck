import { z } from "zod";
import { invokeCommand, mentionCandidatesSchema, MentionCandidate } from "./runtime";

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

export const workItemSummariesSchema = z.array(workItemSummarySchema);

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

const classificationNodeOptionSchema = z.object({
  name: z.string(),
  path: z.string(),
  depth: z.number(),
  hasChildren: z.boolean(),
  startDate: z.string().nullable(),
  finishDate: z.string().nullable(),
});

const classificationNodesResultSchema = z.object({
  areas: z.array(classificationNodeOptionSchema),
  iterations: z.array(classificationNodeOptionSchema),
});

export type ClassificationNodeOption = z.infer<typeof classificationNodeOptionSchema>;
export type ClassificationNodesResult = z.infer<typeof classificationNodesResultSchema>;

export const COMMENT_REACTION_TYPES = [
  "like",
  "heart",
  "hooray",
  "smile",
  "confused",
  "dislike",
] as const;
export type CommentReactionType = (typeof COMMENT_REACTION_TYPES)[number];

const commentReactionSchema = z.object({
  reactionType: z.string(),
  count: z.number(),
  isMine: z.boolean(),
});

export const workItemCommentSchema = z.object({
  id: z.number(),
  text: z.string().nullable(),
  renderedText: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdById: z.string().nullable().optional(),
  createdByUniqueName: z.string().nullable().optional(),
  createdDate: z.string().nullable(),
  reactions: z.array(commentReactionSchema).optional(),
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

const workItemPullRequestLinkSchema = z.object({
  pullRequestId: z.number(),
  repositoryId: z.string().nullable(),
  title: z.string().nullable(),
  status: z.string().nullable(),
  myVoteLabel: z.string().nullable(),
  webUrl: z.string().nullable(),
});

export type WorkItemPullRequestLink = z.infer<typeof workItemPullRequestLinkSchema>;

const workItemAttachmentSchema = z.object({
  name: z.string(),
  url: z.string(),
});
export type WorkItemAttachment = z.infer<typeof workItemAttachmentSchema>;

export const workItemPreviewSchema = z.object({
  organizationId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  id: z.number(),
  title: z.string(),
  workItemType: z.string().nullable(),
  state: z.string().nullable(),
  assignedTo: z.string().nullable(),
  assignedToUniqueName: z.string().nullable(),
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
  commentsUnavailable: z.boolean().default(false),
  relations: z.array(workItemRelationSchema).default([]),
  pullRequests: z.array(workItemPullRequestLinkSchema).default([]),
  attachments: z.array(workItemAttachmentSchema).default([]),
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

export type BulkWorkItemResult = {
  id: number;
  error: string | null;
};

export const bulkWorkItemResultSchema = z.object({
  id: z.number(),
  error: z.string().nullable(),
});
export const bulkWorkItemResultsSchema = z.array(bulkWorkItemResultSchema);

const workItemImageSchema = z.object({
  dataUrl: z.string(),
});

export type SearchWorkItemsInput = {
  organizationId?: string;
  query?: string;
  /** States to include. Empty/omitted means all states. */
  states?: string[];
  /** Work item types to include. Empty/omitted means any type. */
  workItemTypes?: string[];
  /** Projects to include. Empty/omitted means all projects. */
  projectIds?: string[];
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

export type FetchWorkItemImageInput = {
  organizationId?: string;
  url: string;
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

export type ListWorkItemTypeStatesInput = {
  organizationId?: string;
  projectId: string;
  workItemType: string;
};

export type ListWorkItemFieldsInput = {
  organizationId?: string;
  projectId: string;
};

export type ListClassificationNodesInput = {
  organizationId?: string;
  projectId: string;
};

export type GetSavedQueryInput = {
  organizationId?: string;
  projectId: string;
  queryId: string;
};

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

export async function fetchWorkItemImage(
  input: FetchWorkItemImageInput,
): Promise<string> {
  const result = await invokeCommand("fetch_work_item_image", { input });
  return workItemImageSchema.parse(result).dataUrl;
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

export async function listClassificationNodes(
  input: ListClassificationNodesInput,
): Promise<ClassificationNodesResult> {
  const result = await invokeCommand("list_classification_nodes", { input });
  return classificationNodesResultSchema.parse(result);
}

export async function getSavedQuery(
  input: GetSavedQueryInput,
): Promise<SavedQueryResult> {
  const result = await invokeCommand("get_saved_query", { input });
  return savedQueryResultSchema.parse(result);
}
