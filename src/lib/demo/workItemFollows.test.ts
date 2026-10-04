import { describe, expect, it, beforeEach } from "vitest";
import {
  demoFollowWorkItem,
  demoListFollowedWorkItems,
  demoUnfollowWorkItem,
} from "./workItemFollows";
import { demoOrganization } from "./settings";
import type { FollowWorkItemInput } from "@/lib/commands/workItemFollows";

function sampleInput(overrides: Partial<FollowWorkItemInput> = {}): FollowWorkItemInput {
  return {
    projectId: "p1",
    projectName: "Project One",
    workItemId: 42,
    title: "Fix login",
    workItemType: "Bug",
    state: "Active",
    assignedTo: "Alice",
    webUrl: "https://dev.azure.com/contoso/p1/_workitems/edit/42",
    ...overrides,
  };
}

describe("demo work item follow store", () => {
  beforeEach(() => {
    // The store is module-level state shared across tests; reset by
    // unfollowing whatever the previous test may have left behind.
    for (const item of demoListFollowedWorkItems()) {
      demoUnfollowWorkItem(item.id);
    }
  });

  it("starts empty", () => {
    expect(demoListFollowedWorkItems()).toEqual([]);
  });

  it("follows an item and lists it back as a WorkItemSummary", () => {
    demoFollowWorkItem(sampleInput());

    const items = demoListFollowedWorkItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      organizationId: demoOrganization.id,
      id: 42,
      title: "Fix login",
      workItemType: "Bug",
      state: "Active",
      assignedTo: "Alice",
    });
  });

  it("unfollows an item", () => {
    demoFollowWorkItem(sampleInput());
    demoUnfollowWorkItem(42);
    expect(demoListFollowedWorkItems()).toEqual([]);
  });

  it("re-following the same item refreshes its snapshot instead of duplicating", () => {
    demoFollowWorkItem(sampleInput());
    demoFollowWorkItem(sampleInput({ title: "Fix login timeout", state: "Resolved" }));

    const items = demoListFollowedWorkItems();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Fix login timeout");
    expect(items[0].state).toBe("Resolved");
  });
});
