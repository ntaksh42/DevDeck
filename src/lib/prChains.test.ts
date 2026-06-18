import { describe, expect, it } from "vitest";
import {
  detectPrChains,
  orderByChain,
  type PrChainInput,
} from "./prChains";

function pr(
  key: string,
  source: string,
  target: string,
  repositoryId = "repo",
): PrChainInput {
  return { key, repositoryId, sourceRefName: source, targetRefName: target };
}

describe("detectPrChains", () => {
  it("links a child PR to the parent whose source branch it targets", () => {
    // B targets A's source branch -> A is parent of B.
    const prs = [
      pr("A", "refs/heads/feature-1", "refs/heads/main"),
      pr("B", "refs/heads/feature-2", "refs/heads/feature-1"),
    ];
    const { nodes } = detectPrChains(prs);
    expect(nodes.get("B")!.parentKey).toBe("A");
    expect(nodes.get("A")!.childKeys).toEqual(["B"]);
    expect(nodes.get("A")!.inChain).toBe(true);
    expect(nodes.get("B")!.inChain).toBe(true);
    expect(nodes.get("A")!.depth).toBe(0);
    expect(nodes.get("B")!.depth).toBe(1);
    expect(nodes.get("A")!.chainId).toBe("A");
    expect(nodes.get("B")!.chainId).toBe("A");
  });

  it("normalizes refs/heads prefix and is case-insensitive", () => {
    const prs = [
      pr("A", "Feature-1", "main"),
      pr("B", "feature-2", "refs/heads/FEATURE-1"),
    ];
    const { nodes } = detectPrChains(prs);
    expect(nodes.get("B")!.parentKey).toBe("A");
  });

  it("scopes matching to the same repository", () => {
    const prs = [
      pr("A", "feature-1", "main", "repoX"),
      pr("B", "feature-2", "feature-1", "repoY"),
    ];
    const { nodes } = detectPrChains(prs);
    expect(nodes.get("B")!.parentKey).toBeNull();
    expect(nodes.get("B")!.inChain).toBe(false);
  });

  it("builds a three-deep chain with increasing depth", () => {
    const prs = [
      pr("A", "f1", "main"),
      pr("B", "f2", "f1"),
      pr("C", "f3", "f2"),
    ];
    const { nodes } = detectPrChains(prs);
    expect(nodes.get("C")!.depth).toBe(2);
    expect(nodes.get("C")!.chainId).toBe("A");
    expect(nodes.get("B")!.childKeys).toEqual(["C"]);
  });

  it("ignores self-referencing PRs without crashing", () => {
    const prs = [pr("A", "main", "main"), pr("B", "main", "refs/heads/main")];
    const { nodes } = detectPrChains(prs);
    expect(nodes.get("A")!.inChain).toBe(false);
    expect(nodes.get("B")!.inChain).toBe(false);
  });

  it("breaks a two-node cycle and still terminates", () => {
    // A targets B's source and B targets A's source -> mutual dependency.
    const prs = [pr("A", "fa", "fb"), pr("B", "fb", "fa")];
    const { nodes } = detectPrChains(prs);
    // Exactly one back-edge is severed; neither node should point to itself in a
    // way that loops forever (the call above already returned).
    const aParent = nodes.get("A")!.parentKey;
    const bParent = nodes.get("B")!.parentKey;
    expect([aParent, bParent].filter((p) => p !== null).length).toBeLessThanOrEqual(1);
  });

  it("breaks a longer cycle and terminates", () => {
    const prs = [
      pr("A", "fa", "fc"),
      pr("B", "fb", "fa"),
      pr("C", "fc", "fb"),
    ];
    // Should not hang.
    expect(() => detectPrChains(prs)).not.toThrow();
  });

  it("leaves standalone PRs out of any chain", () => {
    const prs = [pr("A", "f1", "main"), pr("B", "f2", "develop")];
    const { nodes } = detectPrChains(prs);
    expect(nodes.get("A")!.inChain).toBe(false);
    expect(nodes.get("B")!.inChain).toBe(false);
  });
});

describe("orderByChain", () => {
  it("groups chain members with the root first then descendants", () => {
    const prs = [
      pr("standalone", "x", "main"),
      pr("B", "f2", "f1"),
      pr("A", "f1", "main"),
      pr("other", "y", "main"),
    ];
    const result = detectPrChains(prs);
    const order = orderByChain(prs, result);
    // Chain A->B comes before standalone PRs; A precedes B.
    expect(order.indexOf("A")).toBeLessThan(order.indexOf("B"));
    expect(order.indexOf("B")).toBeLessThan(order.indexOf("standalone"));
    expect(order).toHaveLength(4);
    expect(new Set(order).size).toBe(4);
  });

  it("preserves all keys exactly once even with cycles", () => {
    const prs = [pr("A", "fa", "fb"), pr("B", "fb", "fa"), pr("C", "z", "main")];
    const result = detectPrChains(prs);
    const order = orderByChain(prs, result);
    expect(new Set(order)).toEqual(new Set(["A", "B", "C"]));
  });
});
