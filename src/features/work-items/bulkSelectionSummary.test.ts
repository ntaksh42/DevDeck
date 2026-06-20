import { describe, expect, it } from "vitest";

import { summarizeBy } from "./WorkItemsGrid";

describe("summarizeBy", () => {
  it("counts non-empty values", () => {
    expect(summarizeBy(["Bug", "Bug", "Task"])).toEqual([
      { label: "Bug", count: 2 },
      { label: "Task", count: 1 },
    ]);
  });

  it("ignores null, undefined, and blank values", () => {
    expect(summarizeBy(["Bug", null, undefined, "  ", "Task"])).toEqual([
      { label: "Bug", count: 1 },
      { label: "Task", count: 1 },
    ]);
  });

  it("orders by count then label", () => {
    expect(summarizeBy(["New", "Active", "Active", "Closed"])).toEqual([
      { label: "Active", count: 2 },
      { label: "Closed", count: 1 },
      { label: "New", count: 1 },
    ]);
  });

  it("returns an empty array when nothing is selected", () => {
    expect(summarizeBy([])).toEqual([]);
  });
});
