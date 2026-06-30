import type { WorkItemSummary } from "@/lib/azdoCommands";
import type { FollowWorkItemInput } from "@/lib/commands/workItemFollows";
import { demoOrganization } from "@/lib/demo/settings";

// In-memory follow watchlist for browser demo mode, mirroring the Rust
// `followed_work_items` table: a denormalized snapshot of the item captured at
// follow time, keyed by work item id (demo mode has a single organization).
const demoFollows = new Map<number, WorkItemSummary>();

export function demoFollowWorkItem(input: FollowWorkItemInput): void {
  demoFollows.set(input.workItemId, {
    organizationId: demoOrganization.id,
    projectId: input.projectId,
    projectName: input.projectName,
    id: input.workItemId,
    title: input.title,
    workItemType: input.workItemType,
    state: input.state,
    assignedTo: input.assignedTo,
    changedDate: null,
    webUrl: input.webUrl,
    extraFields: [],
    depth: null,
  });
}

export function demoUnfollowWorkItem(workItemId: number): void {
  demoFollows.delete(workItemId);
}

export function demoListFollowedWorkItems(): WorkItemSummary[] {
  return [...demoFollows.values()];
}
