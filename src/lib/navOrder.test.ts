import { describe, expect, it } from "vitest";
import { DEFAULT_NAV_ORDER, normalizeNavOrder, reorderNav } from "@/lib/navOrder";

describe("normalizeNavOrder", () => {
  it("returns undefined for non-array input so callers fall back", () => {
    expect(normalizeNavOrder(null)).toBeUndefined();
    expect(normalizeNavOrder("workItems")).toBeUndefined();
    expect(normalizeNavOrder({})).toBeUndefined();
  });

  it("preserves a valid reordering of all known ids", () => {
    const reordered = ["codeSearch", "pipelines", "workItems", "pullRequests", "wiki"];
    expect(normalizeNavOrder(reordered)).toEqual(reordered);
  });

  it("drops unknown ids (including the retired 'commits') and duplicates", () => {
    const raw = ["commits", "pipelines", "bogus", "pipelines", "pullRequests"];
    expect(normalizeNavOrder(raw)).toEqual([
      "pipelines",
      "pullRequests",
      // remaining known ids appended in default order
      "workItems",
      "codeSearch",
      "wiki",
    ]);
  });

  it("appends known ids missing from stored data", () => {
    // Simulates older stored data from before an entry existed.
    expect(normalizeNavOrder(["pipelines"])).toEqual([
      "pipelines",
      "pullRequests",
      "workItems",
      "codeSearch",
      "wiki",
    ]);
  });

  it("returns the full default set for an empty array", () => {
    expect(normalizeNavOrder([])).toEqual(DEFAULT_NAV_ORDER);
  });
});

describe("reorderNav", () => {
  it("moves an item forward to the target position", () => {
    // Move "pipelines" up to where "pullRequests" is.
    expect(reorderNav(DEFAULT_NAV_ORDER, "pipelines", "pullRequests")).toEqual([
      "pipelines",
      "pullRequests",
      "workItems",
      "codeSearch",
      "wiki",
    ]);
  });

  it("moves an item backward to the target position", () => {
    // Move "pullRequests" down to where "pipelines" is.
    expect(reorderNav(DEFAULT_NAV_ORDER, "pullRequests", "pipelines")).toEqual([
      "workItems",
      "pipelines",
      "pullRequests",
      "codeSearch",
      "wiki",
    ]);
  });

  it("returns the same array reference for a no-op move", () => {
    expect(reorderNav(DEFAULT_NAV_ORDER, "pipelines", "pipelines")).toBe(DEFAULT_NAV_ORDER);
  });

  it("does not mutate the input array", () => {
    const input = [...DEFAULT_NAV_ORDER];
    reorderNav(input, "codeSearch", "pullRequests");
    expect(input).toEqual(DEFAULT_NAV_ORDER);
  });
});
