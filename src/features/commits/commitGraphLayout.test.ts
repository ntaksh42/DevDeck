import { describe, expect, it } from "vitest";
import { assignCommitGraphLanes, graphLaneCount, type GraphCommitInput } from "./commitGraphLayout";

function lanesOf(rows: ReturnType<typeof assignCommitGraphLanes>) {
  return rows.map((r) => r.lane);
}

describe("assignCommitGraphLanes", () => {
  it("keeps a linear history in a single lane", () => {
    const commits: GraphCommitInput[] = [
      { id: "c3", parents: ["c2"] },
      { id: "c2", parents: ["c1"] },
      { id: "c1", parents: ["c0"] },
      { id: "c0", parents: [] },
    ];
    const rows = assignCommitGraphLanes(commits);
    expect(lanesOf(rows)).toEqual([0, 0, 0, 0]);
    expect(graphLaneCount(rows)).toBe(1);
    // Every edge continues straight down in the same lane.
    for (const row of rows) {
      for (const edge of row.edges) {
        expect(edge.toLane).toBe(row.lane);
        expect(edge.isMerge).toBe(false);
      }
    }
  });

  it("opens a second lane for a simple two-branch merge and reconverges at the shared ancestor", () => {
    // M merges branch B into mainline A; both branches share "root".
    const commits: GraphCommitInput[] = [
      { id: "M", parents: ["A", "B"] },
      { id: "A", parents: ["root"] },
      { id: "B", parents: ["root"] },
      { id: "root", parents: [] },
    ];
    const rows = assignCommitGraphLanes(commits);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    // Merge commit sits in lane 0 and fans out to lane 0 (first parent) and
    // a fresh lane 1 (merge parent).
    expect(byId.M.lane).toBe(0);
    expect(byId.M.edges).toEqual([
      { parentId: "A", fromLane: 0, toLane: 0, isMerge: false },
      { parentId: "B", fromLane: 0, toLane: 1, isMerge: true },
    ]);

    // A continues straight down in lane 0; B occupies lane 1.
    expect(byId.A.lane).toBe(0);
    expect(byId.B.lane).toBe(1);

    // Both branches point at the same ancestor. Whichever lane "root" is
    // realized in, both edges must target that same lane so the lines
    // actually meet instead of dangling in different columns.
    const rootLane = byId.root.lane;
    expect(byId.A.edges[0]).toEqual({
      parentId: "root",
      fromLane: 0,
      toLane: rootLane,
      isMerge: false,
    });
    expect(byId.B.edges[0]).toEqual({
      parentId: "root",
      fromLane: 1,
      toLane: rootLane,
      isMerge: false,
    });
    expect(byId.root.edges).toEqual([]);
  });

  it("keeps three independent parallel branches in separate lanes with no interference", () => {
    const commits: GraphCommitInput[] = [
      { id: "a2", parents: ["a1"] },
      { id: "b2", parents: ["b1"] },
      { id: "c2", parents: ["c1"] },
      { id: "a1", parents: [] },
      { id: "b1", parents: [] },
      { id: "c1", parents: [] },
    ];
    const rows = assignCommitGraphLanes(commits);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    expect(byId.a1.lane).toBe(byId.a2.lane);
    expect(byId.b1.lane).toBe(byId.b2.lane);
    expect(byId.c1.lane).toBe(byId.c2.lane);
    // Three genuinely distinct branches need three distinct lanes.
    const distinctLanes = new Set([byId.a2.lane, byId.b2.lane, byId.c2.lane]);
    expect(distinctLanes.size).toBe(3);
    expect(graphLaneCount(rows)).toBe(3);
  });

  it("handles an octopus merge with three parents, giving each a lane", () => {
    const commits: GraphCommitInput[] = [
      { id: "octopus", parents: ["p1", "p2", "p3"] },
      { id: "p1", parents: [] },
      { id: "p2", parents: [] },
      { id: "p3", parents: [] },
    ];
    const rows = assignCommitGraphLanes(commits);
    const octopus = rows[0];
    expect(octopus.lane).toBe(0);
    expect(octopus.edges).toHaveLength(3);
    expect(octopus.edges[0]).toMatchObject({ parentId: "p1", toLane: 0, isMerge: false });
    expect(octopus.edges[1]).toMatchObject({ parentId: "p2", isMerge: true });
    expect(octopus.edges[2]).toMatchObject({ parentId: "p3", isMerge: true });
    // The two extra parents must land in two different lanes from each
    // other and from the mainline.
    const laneSet = new Set(octopus.edges.map((e) => e.toLane));
    expect(laneSet.size).toBe(3);
  });

  it("reuses a freed lane for an unrelated later root instead of growing indefinitely", () => {
    // First branch (x2 -> x1, a root) finishes before the second, unrelated
    // branch (y2 -> y1, a different root) starts.
    const commits: GraphCommitInput[] = [
      { id: "x2", parents: ["x1"] },
      { id: "x1", parents: [] },
      { id: "y2", parents: ["y1"] },
      { id: "y1", parents: [] },
    ];
    const rows = assignCommitGraphLanes(commits);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    // x1 fully closes out lane 0 before y2 appears, so y2 should reuse lane 0
    // rather than opening a second lane that is never needed again.
    expect(byId.x2.lane).toBe(0);
    expect(byId.x1.lane).toBe(0);
    expect(byId.y2.lane).toBe(0);
    expect(byId.y1.lane).toBe(0);
    expect(graphLaneCount(rows)).toBe(1);
  });

  it("draws a dangling edge for a parent outside the fetched window without crashing", () => {
    // "oldest" references a parent that was never fetched (pagination
    // boundary, or a failed per-commit lookup).
    const commits: GraphCommitInput[] = [
      { id: "newest", parents: ["oldest"] },
      { id: "oldest", parents: ["not-in-window"] },
    ];
    const rows = assignCommitGraphLanes(commits);
    expect(rows).toHaveLength(2);
    const oldest = rows[1];
    expect(oldest.edges).toEqual([
      { parentId: "not-in-window", fromLane: 0, toLane: 0, isMerge: false },
    ]);
    // The dangling parent never appears as a row, so it never gets freed —
    // graphLaneCount must still return a finite, sane value.
    expect(graphLaneCount(rows)).toBe(1);
  });

  it("returns an empty layout for an empty commit list", () => {
    const rows = assignCommitGraphLanes([]);
    expect(rows).toEqual([]);
    expect(graphLaneCount(rows)).toBe(0);
  });

  it("handles a commit with no parents (root) with no outgoing edges", () => {
    const rows = assignCommitGraphLanes([{ id: "only", parents: [] }]);
    expect(rows).toEqual([
      { id: "only", lane: 0, edges: [], passthroughLanes: [] },
    ]);
  });
});
