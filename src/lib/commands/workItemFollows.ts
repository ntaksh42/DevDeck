import { invokeCommand } from "./runtime";
import { workItemSummariesSchema, type WorkItemSummary } from "./workItems";

// Local "follow" watchlist (issue #304). Azure DevOps has no public REST API
// for the server-side follow/subscription, so following an item stores a
// display snapshot captured from the already-loaded preview/summary rather
// than driving an ADO subscription.
export type FollowWorkItemInput = {
  organizationId?: string;
  projectId: string;
  projectName: string;
  workItemId: number;
  title: string;
  workItemType: string | null;
  state: string | null;
  assignedTo: string | null;
  webUrl: string | null;
};

export async function followWorkItem(input: FollowWorkItemInput): Promise<void> {
  await invokeCommand("follow_work_item", { input });
}

export async function unfollowWorkItem(input: {
  organizationId?: string;
  workItemId: number;
}): Promise<void> {
  await invokeCommand("unfollow_work_item", { input });
}

export async function listFollowedWorkItems(input: {
  organizationId?: string;
}): Promise<WorkItemSummary[]> {
  const result = await invokeCommand("list_followed_work_items", { input });
  return workItemSummariesSchema.parse(result);
}
