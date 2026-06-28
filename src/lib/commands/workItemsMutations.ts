import { invokeCommand } from "./runtime";
import {
  workItemCommentSchema,
  WorkItemComment,
  workItemPreviewSchema,
  WorkItemPreview,
  bulkWorkItemResultsSchema,
  BulkWorkItemResult,
  CommentReactionType,
} from "./workItems";

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

export type UpdateWorkItemCommentInput = {
  organizationId?: string;
  projectId: string;
  workItemId: number;
  commentId: number;
  markdown: string;
};

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

export type SetWorkItemsTagsInput = {
  organizationId?: string;
  projectId: string;
  workItemIds: number[];
  addTags?: string[];
  removeTags?: string[];
};

export type WorkItemLinkType = "Parent" | "Child" | "Related" | "Predecessor" | "Successor";

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

export async function addWorkItemLink(input: {
  organizationId?: string;
  projectId: string;
  workItemId: number;
  targetId: number;
  linkType: WorkItemLinkType;
}): Promise<void> {
  await invokeCommand("add_work_item_link", { input });
}

export async function removeWorkItemLink(input: {
  organizationId?: string;
  projectId: string;
  workItemId: number;
  targetId: number;
  linkType: WorkItemLinkType;
}): Promise<void> {
  await invokeCommand("remove_work_item_link", { input });
}

export async function updateWorkItemComment(
  input: UpdateWorkItemCommentInput,
): Promise<WorkItemComment> {
  const result = await invokeCommand("update_work_item_comment", { input });
  return workItemCommentSchema.parse(result);
}

export async function setWorkItemCommentReaction(input: {
  organizationId?: string;
  projectId: string;
  workItemId: number;
  commentId: number;
  reactionType: CommentReactionType;
  engaged: boolean;
}): Promise<void> {
  await invokeCommand("set_work_item_comment_reaction", { input });
}

export async function updateWorkItemFields(
  input: UpdateWorkItemFieldsInput,
): Promise<WorkItemPreview> {
  const result = await invokeCommand("update_work_item_fields", { input });
  return workItemPreviewSchema.parse(result);
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

export async function setWorkItemsTags(
  input: SetWorkItemsTagsInput,
): Promise<BulkWorkItemResult[]> {
  const result = await invokeCommand("set_work_items_tags", { input });
  return bulkWorkItemResultsSchema.parse(result);
}
