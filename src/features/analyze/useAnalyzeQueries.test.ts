import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeSampleTimestamps } from "./analyzeDateRange";
import type { AnalyzeGroup } from "./analyzeGroupsStorage";
import { useAnalyzeBuckets } from "./useAnalyzeQueries";

const group: AnalyzeGroup = {
  id: "g1",
  name: "Bugs",
  organizationId: "org",
  projectId: "p",
  queries: [],
  granularity: "day",
  rangeCount: 7,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("useAnalyzeBuckets", () => {
  it("moves the window forward while the view stays open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T09:00:00Z"));
    const { result } = renderHook(() => useAnalyzeBuckets(group));
    const opened = analyzeSampleTimestamps(result.current);

    act(() => {
      vi.setSystemTime(new Date("2026-10-15T01:00:00Z"));
      vi.advanceTimersByTime(60_000);
    });
    const later = analyzeSampleTimestamps(result.current);

    // The window rolled over to the new day and samples the later "now".
    expect(later[later.length - 1]).toBe("2026-10-15T01:01:00Z");
    expect(later).not.toEqual(opened);
  });
});
