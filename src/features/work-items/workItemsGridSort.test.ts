import { describe, expect, it } from "vitest";
import type { WorkItemSummary } from "@/lib/azdoCommands";
import { compareWorkItemsDirected } from "./workItemsGridHelpers";
import { extraColumnKey, type ExtraColumn } from "./extraColumns";

function item(id: number, extra: Record<string, string | null>): WorkItemSummary {
  return {
    organizationId: "org-1",
    projectId: "project-1",
    projectName: "Platform",
    id,
    title: `Item ${id}`,
    workItemType: "Bug",
    state: "Active",
    assignedTo: null,
    changedDate: null,
    webUrl: null,
    tags: null,
    depth: null,
    extraFields: Object.entries(extra).map(([referenceName, value]) => ({
      referenceName,
      value,
    })),
  };
}

/** Sorts ids the way the grid does, so the assertions read as row order. */
function sortedIds(
  items: WorkItemSummary[],
  key: string,
  direction: "asc" | "desc",
  columns: ExtraColumn[],
): number[] {
  return [...items]
    .map((value, index) => ({ value, index }))
    .sort(
      (a, b) =>
        compareWorkItemsDirected(a.value, b.value, { key, direction }, columns) ||
        a.index - b.index,
    )
    .map(({ value }) => value.id);
}

const POINTS = "Custom.StoryPoints";
const pointsKey = extraColumnKey(POINTS);
const typedColumns: ExtraColumn[] = [{ referenceName: POINTS, fieldType: "integer" }];
const untypedColumns: ExtraColumn[] = [{ referenceName: POINTS }];

describe("compareWorkItems with extra columns", () => {
  const items = [
    item(1, { [POINTS]: "10" }),
    item(2, { [POINTS]: "2" }),
    item(3, { [POINTS]: null }),
  ];

  it("sorts a typed integer column numerically", () => {
    expect(sortedIds(items, pointsKey, "asc", typedColumns)).toEqual([2, 1, 3]);
  });

  it("keeps empty values last when the direction flips", () => {
    // Descending reverses the populated rows but must not float the blank one
    // to the top of the grid.
    expect(sortedIds(items, pointsKey, "desc", typedColumns)).toEqual([1, 2, 3]);
  });

  it("falls back to text comparison for a column with no recorded type", () => {
    // "10" sorts before "2" as text; the untyped column is the legacy shape.
    expect(sortedIds(items, pointsKey, "asc", untypedColumns)).toEqual([1, 2, 3]);
  });

  it("leaves the order untouched when the column is no longer defined", () => {
    expect(sortedIds(items, pointsKey, "asc", [])).toEqual([1, 2, 3]);
    expect(sortedIds(items, pointsKey, "desc", [])).toEqual([1, 2, 3]);
  });

  it("still sorts the standard columns", () => {
    expect(sortedIds(items, "id", "desc", typedColumns)).toEqual([3, 2, 1]);
  });
});
