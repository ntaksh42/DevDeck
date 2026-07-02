import { describe, expect, it } from "vitest";
import type { WorkItemSummary } from "@/lib/azdoCommands";
import { isWorkItemStale, workItemStaleDays } from "./workItemStale";

const NOW = new Date("2026-06-20T00:00:00Z").getTime();

function makeItem(overrides: Partial<WorkItemSummary>): WorkItemSummary {
  return {
    organizationId: "org",
    projectId: "p",
    projectName: "Project",
    id: 1,
    title: "Item",
    workItemType: "Bug",
    state: "Active",
    assignedTo: null,
    changedDate: null,
    webUrl: null,
    tags: null,
    extraFields: [],
    depth: null,
    ...overrides,
  };
}

describe("workItemStaleDays", () => {
  it("returns the whole-day age for an active item", () => {
    const item = makeItem({ changedDate: "2026-06-10T00:00:00Z" });
    expect(workItemStaleDays(item, NOW)).toBe(10);
  });

  it("returns null for terminal states regardless of age", () => {
    for (const state of ["Done", "closed", "Completed", "Inactive", "Removed"]) {
      const item = makeItem({ state, changedDate: "2026-01-01T00:00:00Z" });
      expect(workItemStaleDays(item, NOW)).toBeNull();
    }
  });

  it("returns null when there is no changed date", () => {
    expect(workItemStaleDays(makeItem({ changedDate: null }), NOW)).toBeNull();
  });

  it("returns null for an unparseable changed date", () => {
    expect(workItemStaleDays(makeItem({ changedDate: "not-a-date" }), NOW)).toBeNull();
  });

  it("treats a null state as eligible (not terminal)", () => {
    const item = makeItem({ state: null, changedDate: "2026-06-01T00:00:00Z" });
    expect(workItemStaleDays(item, NOW)).toBe(19);
  });
});

describe("isWorkItemStale", () => {
  it("is true at or beyond the threshold", () => {
    const item = makeItem({ changedDate: "2026-06-13T00:00:00Z" }); // 7 days
    expect(isWorkItemStale(item, 7, NOW)).toBe(true);
  });

  it("is false below the threshold", () => {
    const item = makeItem({ changedDate: "2026-06-15T00:00:00Z" }); // 5 days
    expect(isWorkItemStale(item, 7, NOW)).toBe(false);
  });

  it("is never stale for a closed item", () => {
    const item = makeItem({ state: "Closed", changedDate: "2025-01-01T00:00:00Z" });
    expect(isWorkItemStale(item, 7, NOW)).toBe(false);
  });
});
