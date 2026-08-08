import { describe, expect, it } from "vitest";
import type { WorkItemSummary } from "@/lib/azdoCommands";
import {
  buildBreakdown,
  mergeQueryResults,
  normalizeAxisValue,
  UNASSIGNED_LABEL,
} from "./analyzeBreakdown";

function item(overrides: Partial<WorkItemSummary> = {}): WorkItemSummary {
  return {
    organizationId: "contoso",
    projectId: "proj1",
    projectName: "Payments",
    id: 1,
    title: "Something",
    workItemType: "Bug",
    state: "Active",
    assignedTo: "Alice Johnson",
    changedDate: null,
    webUrl: null,
    tags: null,
    extraFields: [],
    depth: null,
    ...overrides,
  };
}

describe("normalizeAxisValue", () => {
  it("labels an empty value as unassigned", () => {
    expect(normalizeAxisValue(null)).toBe(UNASSIGNED_LABEL);
    expect(normalizeAxisValue("")).toBe(UNASSIGNED_LABEL);
    expect(normalizeAxisValue("   ")).toBe(UNASSIGNED_LABEL);
  });

  it("strips a trailing address so one person is not two bars", () => {
    expect(normalizeAxisValue("Alice Johnson <alice@example.com>")).toBe("Alice Johnson");
  });

  it("collapses irregular whitespace", () => {
    expect(normalizeAxisValue("  Alice   Johnson ")).toBe("Alice Johnson");
  });
});

describe("buildBreakdown", () => {
  it("counts per assignee, largest first", () => {
    const breakdown = buildBreakdown(
      [
        item({ id: 1, assignedTo: "Alice" }),
        item({ id: 2, assignedTo: "Bob" }),
        item({ id: 3, assignedTo: "Alice" }),
        item({ id: 4, assignedTo: "Alice" }),
      ],
      "assignedTo",
    );

    expect(breakdown.slices.map((slice) => [slice.key, slice.count])).toEqual([
      ["Alice", 3],
      ["Bob", 1],
    ]);
    expect(breakdown.total).toBe(4);
    expect(breakdown.slices[0].ratio).toBe(0.75);
  });

  it("counts per state", () => {
    const breakdown = buildBreakdown(
      [
        item({ id: 1, state: "Active" }),
        item({ id: 2, state: "Blocked" }),
        item({ id: 3, state: "Active" }),
      ],
      "state",
    );
    expect(breakdown.slices.map((slice) => [slice.key, slice.count])).toEqual([
      ["Active", 2],
      ["Blocked", 1],
    ]);
  });

  it("counts per work item type", () => {
    const breakdown = buildBreakdown(
      [
        item({ id: 1, workItemType: "Bug" }),
        item({ id: 2, workItemType: "Task" }),
        item({ id: 3, workItemType: "Bug" }),
      ],
      "workItemType",
    );
    expect(breakdown.slices.map((slice) => [slice.key, slice.count])).toEqual([
      ["Bug", 2],
      ["Task", 1],
    ]);
  });

  it("labels items with no state as unassigned rather than dropping them", () => {
    const breakdown = buildBreakdown(
      [item({ id: 1, state: null }), item({ id: 2, state: "Active" })],
      "state",
    );
    expect(breakdown.total).toBe(2);
    expect(breakdown.slices.map((slice) => slice.key).sort()).toEqual(
      ["Active", UNASSIGNED_LABEL].sort(),
    );
  });

  it("gathers unassigned items into one row", () => {
    const breakdown = buildBreakdown(
      [item({ id: 1, assignedTo: null }), item({ id: 2, assignedTo: "  " })],
      "assignedTo",
    );
    expect(breakdown.slices).toHaveLength(1);
    expect(breakdown.slices[0]).toMatchObject({ key: UNASSIGNED_LABEL, count: 2 });
  });

  it("breaks ties by name so the order does not shuffle between refreshes", () => {
    const breakdown = buildBreakdown(
      [item({ id: 1, assignedTo: "Zoe" }), item({ id: 2, assignedTo: "Adam" })],
      "assignedTo",
    );
    expect(breakdown.slices.map((slice) => slice.key)).toEqual(["Adam", "Zoe"]);
  });

  it("folds the long tail into a single other row", () => {
    const items = Array.from({ length: 10 }, (_, index) =>
      item({ id: index, assignedTo: `Person ${index}` }),
    );
    const breakdown = buildBreakdown(items, "assignedTo", 3);

    expect(breakdown.slices).toHaveLength(4);
    expect(breakdown.slices[3].isOther).toBe(true);
    expect(breakdown.slices[3].count).toBe(7);
    // The folded rows still count toward the total.
    expect(breakdown.slices.reduce((sum, slice) => sum + slice.count, 0)).toBe(10);
    expect(breakdown.distinctCount).toBe(10);
  });

  it("does not fold when it would only hide one name", () => {
    const items = Array.from({ length: 4 }, (_, index) =>
      item({ id: index, assignedTo: `Person ${index}` }),
    );
    const breakdown = buildBreakdown(items, "assignedTo", 3);
    expect(breakdown.slices).toHaveLength(4);
    expect(breakdown.slices.some((slice) => slice.isOther)).toBe(false);
  });

  it("returns an empty breakdown for no items", () => {
    const breakdown = buildBreakdown([], "assignedTo");
    expect(breakdown.slices).toEqual([]);
    expect(breakdown.total).toBe(0);
  });

  it("groups by state and type as well", () => {
    const items = [
      item({ id: 1, state: "Active", workItemType: "Bug" }),
      item({ id: 2, state: "New", workItemType: "Bug" }),
      item({ id: 3, state: "Active", workItemType: "Task" }),
    ];
    expect(buildBreakdown(items, "state").slices[0]).toMatchObject({
      key: "Active",
      count: 2,
    });
    expect(buildBreakdown(items, "workItemType").slices[0]).toMatchObject({
      key: "Bug",
      count: 2,
    });
  });
});

describe("mergeQueryResults", () => {
  it("counts an item shared by two queries only once", () => {
    const shared = item({ id: 7 });
    const merged = mergeQueryResults([[shared], [shared, item({ id: 8 })]]);
    expect(merged.map((entry) => entry.id)).toEqual([7, 8]);
  });

  it("keeps the same id in different projects apart", () => {
    const merged = mergeQueryResults([
      [item({ id: 5, projectId: "proj1" })],
      [item({ id: 5, projectId: "proj2" })],
    ]);
    expect(merged).toHaveLength(2);
  });

  it("skips queries that have not resolved yet", () => {
    expect(mergeQueryResults([undefined, [item({ id: 1 })], undefined])).toHaveLength(1);
  });
});
