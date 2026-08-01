import { beforeEach, describe, expect, it } from "vitest";
import {
  clampExtraColumnWidth,
  extraColumnWidth,
  loadExtraColumnSelection,
  loadExtraColumnWidths,
  storeExtraColumnSelection,
  storeExtraColumnWidths,
  DEFAULT_EXTRA_COLUMN_WIDTH,
  MAX_EXTRA_COLUMN_WIDTH,
  MIN_EXTRA_COLUMN_WIDTH,
} from "./extraColumns";

beforeEach(() => {
  window.localStorage.clear();
});

describe("extra column selection storage", () => {
  it("round-trips a selection for one screen", () => {
    storeExtraColumnSelection("workItemSearch", [
      { referenceName: "Custom.Due", fieldType: "dateTime" },
    ]);
    expect(loadExtraColumnSelection("workItemSearch")).toEqual([
      { referenceName: "Custom.Due", fieldType: "dateTime" },
    ]);
  });

  it("keeps each screen's selection separate", () => {
    storeExtraColumnSelection("workItemSearch", [{ referenceName: "Custom.A" }]);
    expect(loadExtraColumnSelection("myWorkItems")).toEqual([]);
  });

  it("returns an empty selection when nothing is stored", () => {
    expect(loadExtraColumnSelection("workItemSearch")).toEqual([]);
  });

  it("drops entries that are no longer valid reference names", () => {
    storeExtraColumnSelection("workItemSearch", [
      { referenceName: "Custom.Valid" },
      { referenceName: "bogus" } as never,
    ]);
    expect(loadExtraColumnSelection("workItemSearch")).toEqual([
      { referenceName: "Custom.Valid" },
    ]);
  });
});

describe("extra column widths", () => {
  it("round-trips widths keyed case-insensitively by reference name", () => {
    storeExtraColumnWidths({ "custom.due": 200 });
    expect(extraColumnWidth(loadExtraColumnWidths(), "Custom.Due")).toBe(200);
  });

  it("falls back to the default width for an unknown field", () => {
    expect(extraColumnWidth({}, "Custom.Missing")).toBe(DEFAULT_EXTRA_COLUMN_WIDTH);
  });

  it("clamps stored widths into the allowed range on load", () => {
    storeExtraColumnWidths({ "custom.tiny": 1, "custom.huge": 99999 });
    const widths = loadExtraColumnWidths();
    expect(extraColumnWidth(widths, "Custom.Tiny")).toBe(MIN_EXTRA_COLUMN_WIDTH);
    expect(extraColumnWidth(widths, "Custom.Huge")).toBe(MAX_EXTRA_COLUMN_WIDTH);
  });

  it("ignores non-numeric stored widths", () => {
    window.localStorage.setItem(
      "azdodeck:layout:wiExtraColumnWidths:v1",
      JSON.stringify({ "custom.bad": "wide" }),
    );
    expect(extraColumnWidth(loadExtraColumnWidths(), "Custom.Bad")).toBe(
      DEFAULT_EXTRA_COLUMN_WIDTH,
    );
  });

  it("rounds and clamps a dragged width", () => {
    expect(clampExtraColumnWidth(140.6)).toBe(141);
    expect(clampExtraColumnWidth(10)).toBe(MIN_EXTRA_COLUMN_WIDTH);
    expect(clampExtraColumnWidth(10_000)).toBe(MAX_EXTRA_COLUMN_WIDTH);
  });
});
