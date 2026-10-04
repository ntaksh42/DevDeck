import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PipelineTimeline } from "./PipelineTimeline";
import type { TreeNode } from "./pipelineTimelineTree";

// jsdom has no CSS.escape, which the timeline uses to find a row by node id.
if (typeof CSS === "undefined" || !CSS.escape) {
  Object.defineProperty(globalThis, "CSS", { value: { escape: (value: string) => value } });
}

afterEach(cleanup);

function node(id: string, name: string, logId: number | null): TreeNode {
  return {
    id,
    name,
    type: "Task",
    state: "completed",
    result: "succeeded",
    logId,
    children: [],
  } as unknown as TreeNode;
}

describe("PipelineTimeline keyboard navigation", () => {
  it("moves with arrows and j/k, and opens the log of the focused row with Enter", () => {
    const onSelectLog = vi.fn();
    const tree = [node("a", "Build", 11), node("b", "Test", 12), node("c", "Deploy", null)];
    const view = render(
      <PipelineTimeline
        tree={tree}
        expanded={new Set<string>()}
        selectedLogId={null}
        onToggle={() => {}}
        onSelectLog={onSelectLog}
      />,
    );
    const rows = Array.from(view.container.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    expect(rows).toHaveLength(3);
    rows[0].focus();

    fireEvent.keyDown(rows[0], { key: "j" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1], { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[2]);
    fireEvent.keyDown(rows[2], { key: "k" });
    expect(document.activeElement).toBe(rows[1]);

    fireEvent.keyDown(rows[1], { key: "Enter" });
    expect(onSelectLog).toHaveBeenCalledWith(12);
    expect(screen.getByRole("tree", { name: "Run timeline" })).toBeTruthy();
  });
});
