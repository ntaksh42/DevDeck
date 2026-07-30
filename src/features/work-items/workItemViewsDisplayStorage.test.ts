import { beforeEach, describe, expect, it } from "vitest";
import {
  VIEW_COUNT_HISTORY_LIMIT,
  WI_VIEW_COUNT_HISTORY_STORAGE_KEY,
  loadWorkItemViewsCardMode,
  loadWorkItemViewsCollapsed,
  recordViewCountHistory,
  saveWorkItemViewsCardMode,
  saveWorkItemViewsCollapsed,
  sparklineGeometry,
  viewCountHistory,
} from "./workItemViewsDisplayStorage";

describe("views panel display preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to expanded card mode", () => {
    expect(loadWorkItemViewsCollapsed()).toBe(false);
    expect(loadWorkItemViewsCardMode()).toBe("card");
  });

  it("round-trips the collapsed flag and the card mode", () => {
    saveWorkItemViewsCollapsed(true);
    expect(loadWorkItemViewsCollapsed()).toBe(true);
    saveWorkItemViewsCollapsed(false);
    expect(loadWorkItemViewsCollapsed()).toBe(false);

    saveWorkItemViewsCardMode("compact");
    expect(loadWorkItemViewsCardMode()).toBe("compact");
    saveWorkItemViewsCardMode("card");
    expect(loadWorkItemViewsCardMode()).toBe("card");
  });
});

describe("view count history", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns an empty history for an unknown view", () => {
    expect(viewCountHistory("wi-view-1")).toEqual([]);
  });

  it("appends counts in order", () => {
    recordViewCountHistory("wi-view-1", 3, ["wi-view-1"]);
    recordViewCountHistory("wi-view-1", 5, ["wi-view-1"]);
    recordViewCountHistory("wi-view-1", 4, ["wi-view-1"]);
    expect(viewCountHistory("wi-view-1")).toEqual([3, 5, 4]);
  });

  it("ignores a repeated count so idle sessions do not pad the series", () => {
    recordViewCountHistory("wi-view-1", 3, ["wi-view-1"]);
    recordViewCountHistory("wi-view-1", 3, ["wi-view-1"]);
    expect(viewCountHistory("wi-view-1")).toEqual([3]);
  });

  it("keeps only the most recent points", () => {
    const ids = ["wi-view-1"];
    for (let i = 0; i < VIEW_COUNT_HISTORY_LIMIT + 5; i += 1) {
      recordViewCountHistory("wi-view-1", i, ids);
    }
    const history = viewCountHistory("wi-view-1");
    expect(history).toHaveLength(VIEW_COUNT_HISTORY_LIMIT);
    expect(history[history.length - 1]).toBe(VIEW_COUNT_HISTORY_LIMIT + 4);
  });

  it("prunes history for views that no longer exist", () => {
    recordViewCountHistory("wi-view-1", 1, ["wi-view-1", "wi-view-gone"]);
    recordViewCountHistory("wi-view-gone", 9, ["wi-view-1", "wi-view-gone"]);
    recordViewCountHistory("wi-view-1", 2, ["wi-view-1"]);
    expect(
      JSON.parse(window.localStorage.getItem(WI_VIEW_COUNT_HISTORY_STORAGE_KEY) ?? "{}"),
    ).toEqual({ "wi-view-1": [1, 2] });
  });

  it("drops malformed entries when reading", () => {
    window.localStorage.setItem(
      WI_VIEW_COUNT_HISTORY_STORAGE_KEY,
      JSON.stringify({ "wi-view-1": [1, "x", null, 4], "wi-view-2": "nope" }),
    );
    expect(viewCountHistory("wi-view-1")).toEqual([1, 4]);
    expect(viewCountHistory("wi-view-2")).toEqual([]);
  });
});

describe("sparklineGeometry", () => {
  it("returns null when there are not enough points to show a direction", () => {
    expect(sparklineGeometry([], 100, 30)).toBeNull();
    expect(sparklineGeometry([5], 100, 30)).toBeNull();
  });

  it("maps the lowest count to the bottom and the highest to the top", () => {
    const geometry = sparklineGeometry([0, 10], 100, 30);
    expect(geometry?.line).toBe("0,30 100,0");
    expect(geometry?.last).toEqual({ x: 100, y: 0 });
    expect(geometry?.trend).toBe("up");
  });

  it("draws a flat series along the middle instead of pinning it to an edge", () => {
    const geometry = sparklineGeometry([4, 4, 4], 100, 30);
    expect(geometry?.line).toBe("0,15 50,15 100,15");
    expect(geometry?.trend).toBe("flat");
  });

  it("reports a falling series as a downward trend", () => {
    expect(sparklineGeometry([9, 7, 2], 100, 30)?.trend).toBe("down");
  });

  it("closes the area polygon along the bottom edge", () => {
    expect(sparklineGeometry([0, 10], 100, 30)?.area).toBe("0,30 100,0 100,30 0,30");
  });
});
