import { describe, expect, it } from "vitest";
import { moveColumnBy, normalizeVisibleColumns, showColumn } from "./useColumnVisibility";

const keys = ["a", "b", "c", "d"] as const;

describe("column order", () => {
  it("keeps the stored order and re-adds required columns", () => {
    expect(normalizeVisibleColumns(keys, ["a"], ["c", "x", "b"])).toEqual(["c", "b", "a"]);
  });

  it("moves a column and clamps at the ends", () => {
    expect(moveColumnBy(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
    expect(moveColumnBy(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
  });

  it("shows a column before the next visible canonical column", () => {
    expect(showColumn(keys, ["d", "a"], "b")).toEqual(["b", "d", "a"]);
    expect(showColumn(keys, ["a"], "d")).toEqual(["a", "d"]);
  });
});
