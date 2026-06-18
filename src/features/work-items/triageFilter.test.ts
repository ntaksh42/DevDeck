import { describe, expect, it } from "vitest";
import { filterTriageWorkItems, needsTriage } from "./triageFilter";
import type { WorkItemSummary } from "@/lib/azdoCommands";

function item(overrides: Partial<WorkItemSummary>): WorkItemSummary {
  return {
    organizationId: "contoso",
    projectId: "p1",
    projectName: "Platform",
    id: 1,
    title: "Item",
    workItemType: "Task",
    state: "Active",
    assignedTo: "Demo User",
    changedDate: "2026-06-01T00:00:00Z",
    webUrl: null,
    extraFields: [{ referenceName: "Microsoft.VSTS.Common.Priority", value: "2" }],
    depth: null,
    ...overrides,
  };
}

describe("needsTriage", () => {
  it("excludes active items that have an assignee and a priority", () => {
    expect(needsTriage(item({}))).toBe(false);
  });

  it("includes unassigned active items even when prioritized", () => {
    expect(needsTriage(item({ assignedTo: null }))).toBe(true);
    expect(needsTriage(item({ assignedTo: "  " }))).toBe(true);
  });

  it("includes assigned active items with no priority", () => {
    expect(needsTriage(item({ extraFields: [] }))).toBe(true);
    expect(
      needsTriage(
        item({ extraFields: [{ referenceName: "Microsoft.VSTS.Common.Priority", value: "0" }] }),
      ),
    ).toBe(true);
  });

  it("excludes done/closed/resolved items regardless of assignee or priority", () => {
    for (const state of ["Done", "Closed", "Resolved", "Removed"]) {
      expect(needsTriage(item({ state, assignedTo: null, extraFields: [] }))).toBe(false);
    }
  });
});

describe("filterTriageWorkItems", () => {
  it("returns only the items that need triage", () => {
    const items = [
      item({ id: 1 }), // fully triaged
      item({ id: 2, assignedTo: null }), // unassigned
      item({ id: 3, extraFields: [] }), // no priority
      item({ id: 4, state: "Closed", assignedTo: null, extraFields: [] }), // done
    ];
    expect(filterTriageWorkItems(items).map((i) => i.id)).toEqual([2, 3]);
  });
});
