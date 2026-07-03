import { describe, expect, it } from "vitest";
import { demoCreateWorkItem, demoMyWorkItems, demoWorkItems } from "./workItems";

describe("demoCreateWorkItem", () => {
  it("rejects a blank title", () => {
    expect(() =>
      demoCreateWorkItem({ projectId: "platform", workItemType: "Bug", title: "  " }),
    ).toThrow();
  });

  it("adds the created item to search results", () => {
    const created = demoCreateWorkItem({
      projectId: "platform",
      workItemType: "Bug",
      title: "Created via dialog",
      tags: ["ui", "regression"],
    });
    expect(created.state).toBe("New");
    expect(created.projectName).toBe("Platform");
    expect(created.tags).toBe("ui; regression");

    const found = demoWorkItems().find((item) => item.id === created.id);
    expect(found?.title).toBe("Created via dialog");
    // Unassigned items must not leak into My Work Items.
    expect(demoMyWorkItems().some((item) => item.id === created.id)).toBe(false);
  });

  it("shows items assigned to Demo User in My Work Items", () => {
    const created = demoCreateWorkItem({
      projectId: "mobile",
      workItemType: "Task",
      title: "Assigned to me",
      assignedTo: "Demo User",
    });
    expect(demoMyWorkItems().some((item) => item.id === created.id)).toBe(true);
  });
});
