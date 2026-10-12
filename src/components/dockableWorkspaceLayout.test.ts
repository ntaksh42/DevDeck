import { describe, expect, it, vi } from "vitest";
import type { DockviewApi } from "dockview-react";
import { balanceListAndPreview, minRowWidth } from "./dockableWorkspaceLayout";

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

describe("balanceListAndPreview", () => {
  const panels = [
    { id: "grid", title: "Grid", content: null },
    { id: "preview", title: "Preview", content: null, position: { relativeTo: "grid", direction: "right" as const } },
  ];
  function fakeApi(widths: Record<string, number>, setSize = vi.fn()) {
    const groups = Object.fromEntries(
      Object.entries(widths).map(([id, width]) => [id, { api: { width, setSize: id === "grid" ? setSize : vi.fn() } }]),
    );
    return { getPanel: (id: string) => (groups[id] ? { group: groups[id] } : undefined) } as unknown as DockviewApi;
  }

  it("gives the list 55% of the row it shares with the preview", () => {
    const setSize = vi.fn();
    balanceListAndPreview(fakeApi({ grid: 480, preview: 520 }, setSize), panels);
    expect(setSize).toHaveBeenCalledWith({ width: 550 });
  });

  it("does nothing without a right-hand preview", () => {
    const setSize = vi.fn();
    balanceListAndPreview(fakeApi({ grid: 480 }, setSize), [panels[0]]);
    expect(setSize).not.toHaveBeenCalled();
  });
});
