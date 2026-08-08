import { describe, expect, it } from "vitest";
import {
  axisTicks,
  chartLayout,
  lastDrawnIndex,
  lineRuns,
  valueWithPrevious,
} from "./analyzeChartLayout";

describe("chartLayout", () => {
  it("centres a bucket inside its band", () => {
    const layout = chartLayout(4, 10, 10);
    // Four bands across the plot; the first point sits half a band in.
    expect(layout.xAt(0)).toBeCloseTo(layout.padding.left + layout.bandWidth / 2);
    expect(layout.xAt(3)).toBeCloseTo(layout.padding.left + layout.bandWidth * 3.5);
  });

  it("puts the axis maximum at the top of the plot and zero at the base", () => {
    const layout = chartLayout(4, 20, 8);
    expect(layout.yCount(20)).toBeCloseTo(layout.padding.top);
    expect(layout.yCount(0)).toBeCloseTo(layout.padding.top + layout.plotHeight);
    expect(layout.yVolume(8)).toBeCloseTo(layout.padding.top);
  });

  it("keeps the two axes independent", () => {
    const layout = chartLayout(4, 100, 10);
    // Ten commits is the top of the right axis but a tenth of the left one.
    expect(layout.yVolume(10)).toBeCloseTo(layout.padding.top);
    expect(layout.yCount(10)).toBeGreaterThan(layout.padding.top);
  });

  it("survives an all-zero series without dividing by zero", () => {
    const layout = chartLayout(3, 0, 0);
    expect(Number.isFinite(layout.yCount(0))).toBe(true);
    expect(layout.countMax).toBe(1);
    expect(layout.volumeMax).toBe(1);
  });

  it("never produces a zero band width for an empty bucket list", () => {
    expect(chartLayout(0, 5, 5).bandWidth).toBeGreaterThan(0);
  });
});

describe("axisTicks", () => {
  it("starts at zero and stops at or below the maximum", () => {
    const ticks = axisTicks(20);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(20);
  });

  it("uses round intervals", () => {
    expect(axisTicks(20)).toEqual([0, 5, 10, 15, 20]);
    expect(axisTicks(8)).toEqual([0, 2, 4, 6, 8]);
  });

  it("degrades to a single tick when there is no range", () => {
    expect(axisTicks(0)).toEqual([0]);
    expect(axisTicks(Number.NaN)).toEqual([0]);
  });
});

describe("lineRuns", () => {
  it("returns one run when nothing is missing", () => {
    expect(lineRuns([1, 2, 3])).toEqual([
      [
        { index: 0, value: 1 },
        { index: 1, value: 2 },
        { index: 2, value: 3 },
      ],
    ]);
  });

  it("splits at a gap so the caller can dash across it", () => {
    expect(lineRuns([1, null, 3])).toEqual([
      [{ index: 0, value: 1 }],
      [{ index: 2, value: 3 }],
    ]);
  });

  it("ignores gaps at the ends", () => {
    expect(lineRuns([null, 5, null])).toEqual([[{ index: 1, value: 5 }]]);
  });

  it("returns nothing for an entirely missing series", () => {
    expect(lineRuns([null, null])).toEqual([]);
  });
});

describe("lastDrawnIndex", () => {
  it("skips trailing gaps", () => {
    expect(lastDrawnIndex([1, 2, null])).toBe(1);
  });

  it("returns -1 when there is nothing to draw", () => {
    expect(lastDrawnIndex([null, null])).toBe(-1);
    expect(lastDrawnIndex([])).toBe(-1);
  });
});

describe("valueWithPrevious", () => {
  it("reaches past a gap for the previous value", () => {
    expect(valueWithPrevious([5, null, 9], 2)).toEqual({ value: 9, previous: 5 });
  });

  it("has no previous value at the start of the window", () => {
    expect(valueWithPrevious([5, 9], 0)).toEqual({ value: 5, previous: null });
  });

  it("reports a missing value at the cursor as null", () => {
    expect(valueWithPrevious([5, null], 1)).toEqual({ value: null, previous: 5 });
  });
});
