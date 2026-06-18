// Stacked PR (dependency chain) detection.
//
// A pull request B "depends on" pull request A when B's target branch is A's
// source branch within the same repository: merging B before A would target a
// branch that has not landed yet. We model A as the *parent* of B (A must merge
// first), so a chain reads parent -> child in merge order.

export type PrChainInput = {
  // Stable identity of the PR within the result set.
  key: string;
  repositoryId: string;
  // Branch refs as returned by the backend (e.g. "refs/heads/feature/x" or the
  // already-shortened "feature/x"). Comparison is done on the normalized form.
  sourceRefName: string;
  targetRefName: string;
};

export type PrChainNode = {
  key: string;
  // Parent PR (the one that must merge first), or null when this PR is a root.
  parentKey: string | null;
  // Direct children that target this PR's source branch.
  childKeys: string[];
  // Whether this PR participates in a chain at all (has a parent or a child).
  inChain: boolean;
  // Depth from the chain root (0 for roots), used for indentation.
  depth: number;
  // Stable id shared by every PR in the same chain (the root's key).
  chainId: string | null;
};

export type PrChainResult = {
  // Per-PR chain metadata, keyed by PrChainInput.key.
  nodes: Map<string, PrChainNode>;
};

function normalizeRef(ref: string): string {
  return ref.replace(/^refs\/heads\//, "").trim().toLowerCase();
}

/**
 * Detects stacked-PR dependency chains from a flat list of pull requests.
 *
 * Pure and defensive: self-referencing PRs (source == target) are ignored, and
 * cyclic dependencies are broken so traversal always terminates.
 */
export function detectPrChains(prs: PrChainInput[]): PrChainResult {
  const nodes = new Map<string, PrChainNode>();
  for (const pr of prs) {
    nodes.set(pr.key, {
      key: pr.key,
      parentKey: null,
      childKeys: [],
      inChain: false,
      depth: 0,
      chainId: null,
    });
  }

  // Index PRs by (repository, normalized source branch). A PR's parent is the
  // PR whose source branch equals this PR's target branch in the same repo.
  const bySource = new Map<string, string[]>();
  for (const pr of prs) {
    const source = normalizeRef(pr.sourceRefName);
    if (!source) continue;
    const indexKey = `${pr.repositoryId} ${source}`;
    const bucket = bySource.get(indexKey);
    if (bucket) bucket.push(pr.key);
    else bySource.set(indexKey, [pr.key]);
  }

  for (const pr of prs) {
    const source = normalizeRef(pr.sourceRefName);
    const target = normalizeRef(pr.targetRefName);
    // Ignore self-references: a PR whose source equals its target cannot stack.
    if (!source || !target || source === target) continue;
    const parents = bySource.get(`${pr.repositoryId} ${target}`);
    if (!parents || parents.length === 0) continue;
    // If multiple PRs share the same source branch, pick a deterministic parent
    // (smallest key) so the result is stable regardless of input order.
    const parentKey = [...parents].sort()[0];
    if (parentKey === pr.key) continue; // would be a self-link
    const node = nodes.get(pr.key)!;
    node.parentKey = parentKey;
    nodes.get(parentKey)!.childKeys.push(pr.key);
  }

  // Break cycles: walk each node's parent chain; if a parent is already on the
  // current path it closes a loop, so sever that back-edge.
  for (const start of nodes.values()) {
    const path = new Set<string>();
    let current: PrChainNode | undefined = start;
    while (current && current.parentKey) {
      if (path.has(current.key)) break;
      path.add(current.key);
      const parent = nodes.get(current.parentKey);
      if (!parent) {
        current.parentKey = null;
        break;
      }
      if (path.has(parent.key)) {
        // parent is an ancestor of current on this path -> cycle. Sever it.
        const child = current;
        parent.childKeys = parent.childKeys.filter((k) => k !== child.key);
        current.parentKey = null;
        break;
      }
      current = parent;
    }
  }

  // Assign chainId (root key) and depth by walking up to the root, and mark
  // membership. A PR is "in a chain" if it has a parent or any children.
  for (const node of nodes.values()) {
    if (node.parentKey === null && node.childKeys.length === 0) continue;
    node.inChain = true;
    let depth = 0;
    let rootKey = node.key;
    let cursor: PrChainNode | undefined = node;
    const guard = new Set<string>();
    while (cursor && cursor.parentKey && !guard.has(cursor.key)) {
      guard.add(cursor.key);
      depth += 1;
      rootKey = cursor.parentKey;
      cursor = nodes.get(cursor.parentKey);
    }
    node.depth = depth;
    node.chainId = rootKey;
  }

  return { nodes };
}

/**
 * Orders PRs so chain members are grouped together with their root first,
 * followed by descendants depth-first. PRs not in any chain keep their original
 * relative order and are appended after the chains. Returns keys in display
 * order.
 */
export function orderByChain(prs: PrChainInput[], result: PrChainResult): string[] {
  const { nodes } = result;
  const order: string[] = [];
  const emitted = new Set<string>();
  const positions = new Map(prs.map((pr, index) => [pr.key, index]));

  function indexOf(key: string): number {
    return positions.get(key) ?? Number.MAX_SAFE_INTEGER;
  }

  function emitSubtree(key: string) {
    if (emitted.has(key)) return;
    emitted.add(key);
    order.push(key);
    const node = nodes.get(key);
    if (!node) return;
    // Stable child order: by original position in prs.
    const children = [...node.childKeys].sort((a, b) => indexOf(a) - indexOf(b));
    for (const child of children) emitSubtree(child);
  }

  // First pass: emit each chain rooted at a PR with no parent, in original order.
  for (const pr of prs) {
    const node = nodes.get(pr.key);
    if (!node || !node.inChain) continue;
    if (node.parentKey === null) emitSubtree(pr.key);
  }
  // Any remaining in-chain nodes (e.g. whose root was filtered out) get emitted.
  for (const pr of prs) {
    const node = nodes.get(pr.key);
    if (node?.inChain && !emitted.has(pr.key)) emitSubtree(pr.key);
  }
  // Finally, the standalone PRs in original order.
  for (const pr of prs) {
    if (!emitted.has(pr.key)) {
      emitted.add(pr.key);
      order.push(pr.key);
    }
  }

  return order;
}
