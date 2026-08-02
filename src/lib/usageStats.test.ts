import { beforeEach, describe, expect, it } from "vitest";
import {
  loadUsageStats,
  recordUsage,
  resetUsageStats,
  USAGE_STATS_STORAGE_KEY,
} from "./usageStats";

describe("usageStats", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts at zero", () => {
    expect(loadUsageStats()).toEqual({
      votes: 0,
      resolvedThreads: 0,
      stateChanges: 0,
    });
  });

  it("counts events while the experiment is on", () => {
    recordUsage("votes", true);
    recordUsage("votes", true);
    recordUsage("resolvedThreads", true);
    expect(loadUsageStats()).toEqual({
      votes: 2,
      resolvedThreads: 1,
      stateChanges: 0,
    });
  });

  // The flag is off by default, so counting must not happen behind the user's
  // back and then appear the moment they enable the experiment.
  it("writes nothing while the experiment is off", () => {
    recordUsage("votes", false);
    expect(window.localStorage.getItem(USAGE_STATS_STORAGE_KEY)).toBeNull();
    expect(loadUsageStats().votes).toBe(0);
  });

  it("adds a bulk amount in one write", () => {
    recordUsage("stateChanges", true, 5);
    expect(loadUsageStats().stateChanges).toBe(5);
  });

  it("ignores non-positive amounts", () => {
    recordUsage("stateChanges", true, 0);
    expect(window.localStorage.getItem(USAGE_STATS_STORAGE_KEY)).toBeNull();
  });

  it("falls back to zero on corrupt stored data", () => {
    window.localStorage.setItem(USAGE_STATS_STORAGE_KEY, "not json");
    expect(loadUsageStats().votes).toBe(0);

    window.localStorage.setItem(
      USAGE_STATS_STORAGE_KEY,
      JSON.stringify({ votes: -3, resolvedThreads: "x" }),
    );
    expect(loadUsageStats()).toEqual({
      votes: 0,
      resolvedThreads: 0,
      stateChanges: 0,
    });
  });

  it("clears counts on reset", () => {
    recordUsage("votes", true, 3);
    resetUsageStats();
    expect(loadUsageStats().votes).toBe(0);
  });
});
