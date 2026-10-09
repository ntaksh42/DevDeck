import { describe, expect, it } from "vitest";
import {
  analyzeBuckets,
  analyzeSampleTimestamps,
  bucketRangeEnd,
  bucketRangeStart,
  formatBucketLabel,
  startOfUtcWeek,
} from "./analyzeDateRange";

// 2026-08-05 is a Wednesday, so the Monday that opens its week is 2026-08-03.
const NOW = new Date("2026-08-05T14:30:00Z");

describe("analyzeBuckets", () => {
  it("returns day buckets oldest first, ending with today", () => {
    const buckets = analyzeBuckets("day", 3, NOW);
    expect(buckets.map((bucket) => bucket.key)).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
    ]);
  });

  it("gives each day bucket an exclusive end one day later", () => {
    const [bucket] = analyzeBuckets("day", 1, NOW);
    expect(bucket.start.toISOString()).toBe("2026-08-05T00:00:00.000Z");
    expect(bucket.end.toISOString()).toBe("2026-08-06T00:00:00.000Z");
  });

  it("anchors week buckets to Monday", () => {
    const buckets = analyzeBuckets("week", 3, NOW);
    expect(buckets.map((bucket) => bucket.key)).toEqual([
      "2026-07-20",
      "2026-07-27",
      "2026-08-03",
    ]);
  });

  it("keeps a Sunday inside the week that opened the Monday before it", () => {
    // 2026-08-09 is a Sunday; its week still starts on 2026-08-03.
    expect(startOfUtcWeek(new Date("2026-08-09T23:00:00Z")).toISOString()).toBe(
      "2026-08-03T00:00:00.000Z",
    );
  });

  it("always returns at least one bucket", () => {
    expect(analyzeBuckets("day", 0, NOW)).toHaveLength(1);
  });
});

describe("analyzeSampleTimestamps", () => {
  it("samples a closed bucket at the moment it ends", () => {
    const buckets = analyzeBuckets("day", 2, NOW);
    const [previous] = analyzeSampleTimestamps(buckets, NOW);
    expect(previous).toBe("2026-08-05T00:00:00Z");
  });

  it("samples the bucket in progress at now, never in the future", () => {
    const buckets = analyzeBuckets("day", 2, NOW);
    const timestamps = analyzeSampleTimestamps(buckets, NOW);
    expect(timestamps[timestamps.length - 1]).toBe("2026-08-05T14:30:00Z");
  });

  it("emits second-precision instants without milliseconds", () => {
    const buckets = analyzeBuckets("week", 2, NOW);
    for (const timestamp of analyzeSampleTimestamps(buckets, NOW)) {
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    }
  });
});

describe("range helpers", () => {
  it("reports the first day and the inclusive last day", () => {
    const buckets = analyzeBuckets("day", 3, NOW);
    expect(bucketRangeStart(buckets)).toBe("2026-08-03");
    expect(bucketRangeEnd(buckets)).toBe("2026-08-05");
  });

  it("reports the last day of a weekly window, not the following Monday", () => {
    const buckets = analyzeBuckets("week", 1, NOW);
    expect(bucketRangeEnd(buckets)).toBe("2026-08-09");
  });
});

describe("formatBucketLabel", () => {
  it("labels a day with its weekday", () => {
    const [bucket] = analyzeBuckets("day", 1, NOW);
    expect(formatBucketLabel(bucket, "day")).toBe("08-05 (Wed)");
  });

  it("labels a week by the Monday it opens", () => {
    const [bucket] = analyzeBuckets("week", 1, NOW);
    expect(formatBucketLabel(bucket, "week")).toBe("Week of 08-03");
  });
});
