import { afterEach, describe, expect, it } from "vitest";
import {
  acknowledgeReturn,
  reconcileReturns,
  seedDemoReturn,
} from "./reviewReturnTracking";

afterEach(() => window.localStorage.clear());

const t0 = new Date("2026-06-20T10:00:00Z");
const t1 = new Date("2026-06-20T11:00:00Z");
const t2 = new Date("2026-06-20T12:00:00Z");

describe("reconcileReturns", () => {
  it("does not flag a PR that was never voted on", () => {
    const returned = reconcileReturns([{ key: "r:1", myVote: 0 }], t0);
    expect(returned.has("r:1")).toBe(false);
  });

  it("flags a PR whose vote resets from non-zero to zero", () => {
    // First see my vote, then see it reset to 0 (author pushed).
    reconcileReturns([{ key: "r:1", myVote: -5 }], t0);
    const returned = reconcileReturns([{ key: "r:1", myVote: 0 }], t1);
    expect(returned.has("r:1")).toBe(true);
  });

  it("clears the flag when I vote again", () => {
    reconcileReturns([{ key: "r:1", myVote: -5 }], t0);
    reconcileReturns([{ key: "r:1", myVote: 0 }], t1);
    const returned = reconcileReturns([{ key: "r:1", myVote: 10 }], t2);
    expect(returned.has("r:1")).toBe(false);
  });

  it("keeps the flag across subsequent reconciles until acknowledged", () => {
    reconcileReturns([{ key: "r:1", myVote: -5 }], t0);
    reconcileReturns([{ key: "r:1", myVote: 0 }], t1);
    const stillReturned = reconcileReturns([{ key: "r:1", myVote: 0 }], t2);
    expect(stillReturned.has("r:1")).toBe(true);
  });

  it("prunes tracking for PRs that disappear", () => {
    reconcileReturns([{ key: "r:1", myVote: -5 }], t0);
    reconcileReturns([{ key: "r:1", myVote: 0 }], t1);
    // r:1 gone; a fresh PR with vote 0 should not inherit returned state.
    const returned = reconcileReturns([{ key: "r:2", myVote: 0 }], t2);
    expect(returned.size).toBe(0);
  });
});

describe("acknowledgeReturn", () => {
  it("clears the highlight for an opened returned PR", () => {
    reconcileReturns([{ key: "r:1", myVote: -5 }], t0);
    reconcileReturns([{ key: "r:1", myVote: 0 }], t1);
    acknowledgeReturn("r:1", t2);
    const returned = reconcileReturns([{ key: "r:1", myVote: 0 }], t2);
    expect(returned.has("r:1")).toBe(false);
  });
});

describe("seedDemoReturn", () => {
  it("marks a PR returned, but never overrides existing tracking", () => {
    seedDemoReturn("r:9", t0);
    expect(reconcileReturns([{ key: "r:9", myVote: 0 }], t1).has("r:9")).toBe(true);

    // A PR with real tracking is left alone by the seed.
    reconcileReturns([{ key: "r:1", myVote: 10 }], t0);
    seedDemoReturn("r:1", t1);
    expect(reconcileReturns([{ key: "r:1", myVote: 10 }], t2).has("r:1")).toBe(false);
  });
});
