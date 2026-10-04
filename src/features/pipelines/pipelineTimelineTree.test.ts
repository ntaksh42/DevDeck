import { describe, expect, it } from "vitest";
import type { TimelineNode } from "@/lib/azdoCommands";
import {
  ancestorIdsOfLog,
  buildTimelineTree,
  defaultExpandedIds,
  findFirstFailure,
  flattenVisible,
} from "./pipelineTimelineTree";

function node(partial: Partial<TimelineNode> & { id: string }): TimelineNode {
  return {
    parentId: null,
    nodeType: "Task",
    name: partial.id,
    state: "completed",
    result: "succeeded",
    startTime: null,
    finishTime: null,
    logId: null,
    errorCount: 0,
    warningCount: 0,
    order: 1,
    ...partial,
  };
}

const nodes: TimelineNode[] = [
  node({ id: "stage", nodeType: "Stage", result: "failed", order: 1 }),
  node({ id: "setup", parentId: "stage", nodeType: "Job", order: 1 }),
  node({ id: "setup-task", parentId: "setup", logId: 1, order: 1 }),
  node({ id: "publish", parentId: "stage", nodeType: "Job", result: "failed", order: 2 }),
  node({ id: "pack", parentId: "publish", logId: 2, order: 1 }),
  node({ id: "push", parentId: "publish", logId: 3, result: "failed", errorCount: 2, order: 2 }),
];

describe("pipelineTimeline", () => {
  const tree = buildTimelineTree(nodes);

  it("nests nodes under their parents in order", () => {
    expect(tree.map((n) => n.id)).toEqual(["stage"]);
    expect(tree[0].children.map((n) => n.id)).toEqual(["setup", "publish"]);
  });

  it("finds the deepest failed node that has a log", () => {
    expect(findFirstFailure(tree)?.id).toBe("push");
  });

  it("returns null when nothing failed", () => {
    const ok = buildTimelineTree(nodes.map((n) => ({ ...n, result: "succeeded", errorCount: 0 })));
    expect(findFirstFailure(ok)).toBeNull();
  });

  it("expands only branches that contain something to look at", () => {
    const expanded = defaultExpandedIds(tree);
    expect(expanded.has("stage")).toBe(true);
    expect(expanded.has("publish")).toBe(true);
    expect(expanded.has("setup")).toBe(false);
  });

  it("hides the children of collapsed nodes", () => {
    const rows = flattenVisible(tree, defaultExpandedIds(tree));
    expect(rows.map((r) => r.node.id)).toEqual(["stage", "setup", "publish", "pack", "push"]);
    expect(rows.find((r) => r.node.id === "push")?.depth).toBe(2);
  });

  it("lists the ancestors of a node so it can be revealed", () => {
    expect(ancestorIdsOfLog(tree, 1)).toEqual(["stage", "setup"]);
  });
});
