import type { TimelineNode } from "@/lib/azdoCommands";

export type TreeNode = TimelineNode & { children: TreeNode[] };

export function buildTimelineTree(nodes: TimelineNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const node of nodes) {
    byId.set(node.id, { ...node, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (list: TreeNode[]) => {
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const node of list) sortNodes(node.children);
  };
  sortNodes(roots);
  return roots;
}

function isFailed(node: TimelineNode): boolean {
  return (node.result ?? "").toLowerCase() === "failed";
}

// A node deserves attention (and starts expanded) when it failed, is still
// running, or reported issues, so a successful Stage/Job can stay folded.
function needsAttention(node: TimelineNode): boolean {
  const result = (node.result ?? "").toLowerCase();
  const state = (node.state ?? "").toLowerCase();
  return (
    result === "failed" ||
    result === "partiallysucceeded" ||
    result === "succeededwithissues" ||
    state === "inprogress" ||
    node.errorCount > 0 ||
    node.warningCount > 0
  );
}

function subtreeNeedsAttention(node: TreeNode): boolean {
  return needsAttention(node) || node.children.some(subtreeNeedsAttention);
}

/** Ids of the branches that start expanded: only those containing something to look at. */
export function defaultExpandedIds(tree: TreeNode[]): Set<string> {
  const expanded = new Set<string>();
  const visit = (node: TreeNode) => {
    if (node.children.length > 0 && subtreeNeedsAttention(node)) expanded.add(node.id);
    node.children.forEach(visit);
  };
  tree.forEach(visit);
  return expanded;
}

/** The first failed node (deepest, in timeline order) that has a log to show. */
export function findFirstFailure(tree: TreeNode[]): TreeNode | null {
  for (const node of tree) {
    const inner = findFirstFailure(node.children);
    if (inner) return inner;
    if (isFailed(node) && node.logId != null) return node;
  }
  return null;
}

/** Ids of every ancestor of the node with `logId`, so a selection can be revealed. */
export function ancestorIdsOfLog(tree: TreeNode[], logId: number): string[] {
  const walk = (nodes: TreeNode[], trail: string[]): string[] | null => {
    for (const node of nodes) {
      if (node.logId === logId) return trail;
      const found = walk(node.children, [...trail, node.id]);
      if (found) return found;
    }
    return null;
  };
  return walk(tree, []) ?? [];
}

export function findNodeByLogId(tree: TreeNode[], logId: number): TreeNode | null {
  for (const node of tree) {
    if (node.logId === logId) return node;
    const inner = findNodeByLogId(node.children, logId);
    if (inner) return inner;
  }
  return null;
}

export type VisibleRow = { node: TreeNode; depth: number; parentId: string | null };

/** Rows in display order, skipping the children of collapsed nodes. */
export function flattenVisible(tree: TreeNode[], expanded: Set<string>): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const visit = (nodes: TreeNode[], depth: number, parentId: string | null) => {
    for (const node of nodes) {
      rows.push({ node, depth, parentId });
      if (expanded.has(node.id)) visit(node.children, depth + 1, node.id);
    }
  };
  visit(tree, 0, null);
  return rows;
}

export function allBranchIds(tree: TreeNode[]): Set<string> {
  const ids = new Set<string>();
  const visit = (node: TreeNode) => {
    if (node.children.length > 0) ids.add(node.id);
    node.children.forEach(visit);
  };
  tree.forEach(visit);
  return ids;
}
