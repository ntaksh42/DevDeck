// Lane-assignment for the commit graph (DAG) view. Pure and framework-free so
// it can be unit tested in isolation from rendering.
//
// The algorithm assumes commits are supplied newest-first with each commit
// appearing before its parents (the order Azure DevOps and GitHub both return
// for a single branch/repository) — the same assumption `git log --graph`
// makes. It does not require every parent to also be present in the input:
// a parent outside the fetched window (pagination, or a lookup that failed)
// simply produces an edge with no matching row, which the renderer draws as
// a dangling line off the bottom of the graph.
//
// Approach: walk commits top to bottom, tracking which lane each "expected"
// commit (one referenced as a parent by an earlier row) will land in.
//   - A commit takes over the lane that was waiting for it, or a freed lane,
//     or a brand new lane if none is free.
//   - Its first parent continues straight down in the same lane (matching
//     `git log`'s "first parent" convention for the primary line of history).
//   - Additional parents (merge commits) get their own lane: an existing one
//     if some other branch is already waiting for that same ancestor, else a
//     freed lane, else a new one.
//   - Lanes are reused (first-fit) once freed rather than permanently retired,
//     so the graph does not grow a new column for every short-lived branch.

export interface GraphCommitInput {
  id: string;
  parents: string[];
}

export interface GraphEdge {
  parentId: string;
  fromLane: number;
  toLane: number;
  /** True for every parent after the first — a merge edge. */
  isMerge: boolean;
}

export interface GraphRow {
  id: string;
  lane: number;
  /** Edges from this commit down to each of its parents. */
  edges: GraphEdge[];
  /** Lanes other than `lane` that still have an open branch passing through
   * this row (rendered as an uninterrupted vertical line). */
  passthroughLanes: number[];
}

/**
 * Assigns a lane and parent edges to each commit. `commits` must be ordered
 * newest-first (children before parents); this is a layout function, not a
 * sort — callers are responsible for ordering.
 */
export function assignCommitGraphLanes(commits: GraphCommitInput[]): GraphRow[] {
  // lanes[i] holds the commit id that lane `i` is waiting to place next, or
  // null when the lane is free for reuse.
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];

  function claimLane(id: string): number {
    const waiting = lanes.indexOf(id);
    if (waiting !== -1) return waiting;
    const free = lanes.indexOf(null);
    if (free !== -1) return free;
    lanes.push(null);
    return lanes.length - 1;
  }

  for (const commit of commits) {
    const lane = claimLane(commit.id);
    // Free every lane waiting for this same commit (multiple children can
    // share a parent — those branches converge here), then this commit's own
    // outgoing edges below claim whichever lanes they need.
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === commit.id) lanes[i] = null;
    }

    const edges: GraphEdge[] = commit.parents.map((parentId, index) => {
      const isMerge = index > 0;
      // If some other lane is already waiting for this exact parent (two
      // branches sharing an ancestor), converge into that lane instead of
      // defaulting the first parent to "stay in the same lane" — otherwise
      // the line drawn here would point at a lane the ancestor never
      // actually occupies.
      const existingLane = lanes.indexOf(parentId);
      const toLane = existingLane !== -1 ? existingLane : index === 0 ? lane : claimLane(parentId);
      lanes[toLane] = parentId;
      return { parentId, fromLane: lane, toLane, isMerge };
    });

    const passthroughLanes = lanes
      .map((occupant, i) => (i !== lane && occupant !== null ? i : -1))
      .filter((i) => i !== -1);

    rows.push({ id: commit.id, lane, edges, passthroughLanes });
  }

  return rows;
}

/** Total lane count across all rows — the width the renderer needs to reserve. */
export function graphLaneCount(rows: GraphRow[]): number {
  let max = 0;
  for (const row of rows) {
    max = Math.max(max, row.lane);
    for (const edge of row.edges) max = Math.max(max, edge.toLane);
    for (const lane of row.passthroughLanes) max = Math.max(max, lane);
  }
  return rows.length === 0 ? 0 : max + 1;
}
