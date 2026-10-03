import { describe, expect, it } from "vitest";
import { analyzeBuckets } from "./analyzeDateRange";
import {
  isValidMilestoneDate,
  milestoneStatus,
  milestoneTargetOn,
  milestoneTargets,
  normalizeMilestones,
  suggestNextMilestone,
  type AnalyzeMilestone,
} from "./analyzeMilestones";

const MILESTONES: AnalyzeMilestone[] = [
  { date: "2026-07-14", count: 24 },
  { date: "2026-07-24", count: 18 },
  { date: "2026-08-03", count: 12 },
];

describe("isValidMilestoneDate", () => {
  it("accepts a real calendar day", () => {
    expect(isValidMilestoneDate("2026-08-05")).toBe(true);
  });

  it("rejects malformed and impossible dates", () => {
    expect(isValidMilestoneDate("2026-8-5")).toBe(false);
    expect(isValidMilestoneDate("not-a-date")).toBe(false);
    // Would otherwise roll over into March rather than failing.
    expect(isValidMilestoneDate("2026-02-31")).toBe(false);
  });
});

describe("normalizeMilestones", () => {
  it("sorts ascending by date", () => {
    expect(
      normalizeMilestones([
        { date: "2026-08-03", count: 12 },
        { date: "2026-07-14", count: 24 },
      ]),
    ).toEqual([
      { date: "2026-07-14", count: 24 },
      { date: "2026-08-03", count: 12 },
    ]);
  });

  it("collapses a repeated date so the later entry wins", () => {
    expect(
      normalizeMilestones([
        { date: "2026-07-14", count: 24 },
        { date: "2026-07-14", count: 9 },
      ]),
    ).toEqual([{ date: "2026-07-14", count: 9 }]);
  });

  it("drops entries that are not usable targets", () => {
    expect(
      normalizeMilestones([
        { date: "2026-13-01", count: 5 },
        { date: "2026-07-14", count: -3 },
        { date: "2026-07-15", count: Number.NaN },
        null,
        "nope",
        { date: "2026-07-16", count: 4 },
      ]),
    ).toEqual([{ date: "2026-07-16", count: 4 }]);
  });

  it("returns an empty list for a non-array", () => {
    expect(normalizeMilestones(undefined)).toEqual([]);
    expect(normalizeMilestones({})).toEqual([]);
  });

  it("rounds a fractional count", () => {
    expect(normalizeMilestones([{ date: "2026-07-14", count: 8.6 }])).toEqual([
      { date: "2026-07-14", count: 9 },
    ]);
  });
});

describe("milestoneTargetOn", () => {
  it("has no target before the first milestone", () => {
    expect(milestoneTargetOn(MILESTONES, "2026-07-13")).toBeNull();
  });

  it("hits each milestone exactly", () => {
    expect(milestoneTargetOn(MILESTONES, "2026-07-14")).toBe(24);
    expect(milestoneTargetOn(MILESTONES, "2026-07-24")).toBe(18);
    expect(milestoneTargetOn(MILESTONES, "2026-08-03")).toBe(12);
  });

  it("interpolates linearly between two milestones", () => {
    // Halfway from 24 to 18 across ten days.
    expect(milestoneTargetOn(MILESTONES, "2026-07-19")).toBe(21);
  });

  it("holds flat after the last milestone", () => {
    expect(milestoneTargetOn(MILESTONES, "2026-09-01")).toBe(12);
  });

  it("keeps the slope when a milestone sits outside the window", () => {
    const outside: AnalyzeMilestone[] = [
      { date: "2026-07-01", count: 30 },
      { date: "2026-07-11", count: 20 },
    ];
    expect(milestoneTargetOn(outside, "2026-07-07")).toBe(24);
  });

  it("returns null when there are no milestones", () => {
    expect(milestoneTargetOn([], "2026-07-14")).toBeNull();
  });

  it("uses the single milestone's value from that day onward", () => {
    const single: AnalyzeMilestone[] = [{ date: "2026-07-14", count: 5 }];
    expect(milestoneTargetOn(single, "2026-07-13")).toBeNull();
    expect(milestoneTargetOn(single, "2026-07-14")).toBe(5);
    expect(milestoneTargetOn(single, "2026-08-14")).toBe(5);
  });
});

describe("milestoneTargets", () => {
  it("lines up with the buckets it is given", () => {
    const buckets = analyzeBuckets("day", 3, new Date("2026-07-16T09:00:00Z"));
    // Buckets are 07-14, 07-15, 07-16.
    expect(milestoneTargets(MILESTONES, buckets)).toEqual([24, 23.4, 22.8]);
  });
});

describe("milestoneStatus", () => {
  const buckets = analyzeBuckets("day", 30, new Date("2026-08-05T09:00:00Z"));
  const counts = buckets.map((bucket) =>
    bucket.key === "2026-07-14" ? 25 : bucket.key === "2026-07-24" ? 17 : 13,
  );

  it("marks a past milestone as missed when the actual is above it", () => {
    expect(
      milestoneStatus(MILESTONES[0], MILESTONES, buckets, counts, "2026-08-05"),
    ).toEqual({ kind: "missed", actual: 25, delta: 1 });
  });

  it("marks a past milestone as met when the actual is at or below it", () => {
    expect(
      milestoneStatus(MILESTONES[1], MILESTONES, buckets, counts, "2026-08-05"),
    ).toEqual({ kind: "met", actual: 17, delta: -1 });
  });

  it("judges a future milestone against today's pace", () => {
    const future: AnalyzeMilestone[] = [
      { date: "2026-07-14", count: 24 },
      { date: "2026-08-20", count: 4 },
    ];
    // On 08-05 the line sits at about 12.5; today's actual of 13 is above it.
    const status = milestoneStatus(future[1], future, buckets, counts, "2026-08-05");
    expect(status.kind).toBe("behind");
  });

  it("reports unknown when the day's sample is missing", () => {
    const gaps = buckets.map(() => null);
    expect(
      milestoneStatus(MILESTONES[0], MILESTONES, buckets, gaps, "2026-08-05"),
    ).toEqual({ kind: "unknown" });
  });

  it("reports unknown for a past milestone outside the window", () => {
    const old: AnalyzeMilestone = { date: "2026-01-01", count: 3 };
    expect(milestoneStatus(old, MILESTONES, buckets, counts, "2026-08-05")).toEqual({
      kind: "unknown",
    });
  });
});

describe("suggestNextMilestone", () => {
  it("steps a week past the last milestone and lowers the target", () => {
    expect(suggestNextMilestone(MILESTONES, "2026-08-05", 13)).toEqual({
      date: "2026-08-10",
      count: 8,
    });
  });

  it("falls back to today when nothing is set yet", () => {
    expect(suggestNextMilestone([], "2026-08-05", 13)).toEqual({
      date: "2026-08-05",
      count: 13,
    });
  });

  it("never suggests a date that is already taken", () => {
    const clashing: AnalyzeMilestone[] = [
      { date: "2026-07-14", count: 24 },
      { date: "2026-07-21", count: 20 },
    ];
    // A week past 07-21 is 07-28, which is free.
    expect(suggestNextMilestone(clashing, "2026-08-05", 13).date).toBe("2026-07-28");
  });

  it("never suggests a negative count", () => {
    const low: AnalyzeMilestone[] = [{ date: "2026-07-14", count: 2 }];
    expect(suggestNextMilestone(low, "2026-08-05", 13).count).toBe(0);
  });
});
