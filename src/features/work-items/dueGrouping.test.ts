import { describe, expect, it } from "vitest";
import type { WorkItemSummary } from "@/lib/azdoCommands";
import { dueBucketOf, dueBucketCounts } from "./dueGrouping";

// Local noon so whole-day offsets and small intra-day offsets stay on the
// expected local calendar day regardless of the test machine's timezone.
const NOW = new Date(2026, 5, 20, 12, 0, 0);

function dayOffset(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString();
}

describe("dueBucketOf", () => {
  it("returns 'none' for a missing or unparseable due date", () => {
    expect(dueBucketOf(null, NOW)).toBe("none");
    expect(dueBucketOf(undefined, NOW)).toBe("none");
    expect(dueBucketOf("not-a-date", NOW)).toBe("none");
  });

  it("classifies past dates as overdue", () => {
    expect(dueBucketOf(dayOffset(-1), NOW)).toBe("overdue");
    expect(dueBucketOf(dayOffset(-30), NOW)).toBe("overdue");
  });

  it("classifies the same local day as today", () => {
    // Same instant as NOW, and a few hours either side that stay on the same
    // local calendar day, are all "today".
    expect(dueBucketOf(dayOffset(0), NOW)).toBe("today");
    expect(dueBucketOf(new Date(NOW.getTime() + 3 * 3_600_000).toISOString(), NOW)).toBe(
      "today",
    );
  });

  it("classifies the next seven days as this week, then later", () => {
    expect(dueBucketOf(dayOffset(1), NOW)).toBe("thisWeek");
    expect(dueBucketOf(dayOffset(7), NOW)).toBe("thisWeek");
    expect(dueBucketOf(dayOffset(8), NOW)).toBe("later");
  });
});

describe("dueBucketCounts", () => {
  it("tallies items across buckets", () => {
    const items = [
      { dueDate: dayOffset(-2) },
      { dueDate: dayOffset(0) },
      { dueDate: dayOffset(3) },
      { dueDate: dayOffset(20) },
      { dueDate: null },
    ] as WorkItemSummary[];
    expect(dueBucketCounts(items, NOW)).toEqual({
      overdue: 1,
      today: 1,
      thisWeek: 1,
      later: 1,
      none: 1,
    });
  });
});
