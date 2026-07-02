import { describe, expect, it, beforeEach } from "vitest";
import { buildColumns } from "./WorkItemBoard";
import {
  loadWorkItemViewLayout,
  saveWorkItemViewLayout,
} from "./workItemViewsStorage";
import type { WorkItemSummary } from "@/lib/azdoCommands";

function item(id: number, state: string | null): WorkItemSummary {
  return {
    organizationId: "org",
    projectId: "proj",
    projectName: "Proj",
    id,
    title: `Item ${id}`,
    workItemType: "Bug",
    state,
    assignedTo: null,
    changedDate: null,
    webUrl: null,
    tags: null,
    extraFields: [],
    depth: null,
  };
}

describe("buildColumns", () => {
  it("orders columns by the declared state order and groups items", () => {
    const columns = buildColumns(
      [item(1, "Active"), item(2, "New"), item(3, "Active")],
      ["New", "Active", "Resolved", "Closed"],
    );
    expect(columns.map((c) => c.state)).toEqual([
      "New",
      "Active",
      "Resolved",
      "Closed",
    ]);
    expect(columns[0].items.map((i) => i.id)).toEqual([2]);
    expect(columns[1].items.map((i) => i.id)).toEqual([1, 3]);
    expect(columns[3].items).toEqual([]);
  });

  it("appends states present in results but missing from the declared order", () => {
    const columns = buildColumns(
      [item(1, "New"), item(2, "Custom State")],
      ["New", "Active"],
    );
    expect(columns.map((c) => c.state)).toEqual(["New", "Active", "Custom State"]);
  });

  it("groups items with no state under a fallback column", () => {
    const columns = buildColumns([item(1, null)], ["New"]);
    const fallback = columns.find((c) => c.items.length > 0);
    expect(fallback?.items.map((i) => i.id)).toEqual([1]);
  });
});

describe("work item view layout storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to list and round-trips board per view", () => {
    expect(loadWorkItemViewLayout("view-a")).toBe("list");
    saveWorkItemViewLayout("view-a", "board");
    expect(loadWorkItemViewLayout("view-a")).toBe("board");
    // Independent per view id.
    expect(loadWorkItemViewLayout("view-b")).toBe("list");
  });
});
