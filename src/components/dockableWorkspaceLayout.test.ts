import { describe, expect, it } from "vitest";
import { minRowWidth } from "./dockableWorkspaceLayout";

describe("minRowWidth", () => {
  it("sums the minimum widths of panels split side by side", () => {
    expect(
      minRowWidth([
        { id: "grid", title: "Grid", content: null, minWidth: 480 },
        { id: "preview", title: "Preview", content: null, minWidth: 320, position: { relativeTo: "grid", direction: "right" } },
      ]),
    ).toBe(800);
  });

  it("counts a tab group once, using its widest floor", () => {
    expect(
      minRowWidth([
        { id: "grid", title: "Grid", content: null, minWidth: 480 },
        { id: "preview", title: "Preview", content: null, minWidth: 300, position: { relativeTo: "grid", direction: "right" } },
        { id: "result", title: "Result", content: null, minWidth: 320, position: { relativeTo: "preview", direction: "within" } },
      ]),
    ).toBe(800);
  });

  it("ignores panels stacked above or below, which share the row's width", () => {
    expect(
      minRowWidth([
        { id: "grid", title: "Grid", content: null, minWidth: 480 },
        { id: "preview", title: "Preview", content: null, minWidth: 280, position: { relativeTo: "grid", direction: "right" } },
        { id: "wi", title: "Work Items", content: null, minWidth: 600, position: { relativeTo: "grid", direction: "below" } },
      ]),
    ).toBe(760);
  });

  it("treats panels without a minWidth as zero", () => {
    expect(minRowWidth([{ id: "only", title: "Only", content: null }])).toBe(0);
  });
});
