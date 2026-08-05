import { describe, expect, it } from "vitest";
import { barHeights, chartGeometry, type ChartPoint } from "./analyzeChartGeometry";

function series(values: (number | null)[]): ChartPoint[] {
  return values.map((value, index) => ({ index, value }));
}

describe("chartGeometry", () => {
  it("returns null until two drawable points exist", () => {
    expect(chartGeometry(series([]), 100, 40)).toBeNull();
    expect(chartGeometry(series([5]), 100, 40)).toBeNull();
    expect(chartGeometry(series([5, null]), 100, 40)).toBeNull();
  });

  it("spans the full height between the lowest and highest value", () => {
    const geometry = chartGeometry(series([0, 10]), 100, 40)!;
    expect(geometry.line).toBe("0,40 100,0");
    expect(geometry.min).toBe(0);
    expect(geometry.max).toBe(10);
  });

  it("draws a flat series down the middle instead of on an edge", () => {
    const geometry = chartGeometry(series([7, 7, 7]), 100, 40)!;
    expect(geometry.line).toBe("0,20 50,20 100,20");
    expect(geometry.trend).toBe("flat");
  });

  it("bridges a missing point rather than dipping to zero", () => {
    const geometry = chartGeometry(series([10, null, 10]), 100, 40)!;
    // Two coordinates only, and the x of the second skips to the third slot.
    expect(geometry.line).toBe("0,20 100,20");
  });

  it("keeps x positions aligned to the original slots", () => {
    const geometry = chartGeometry(series([1, null, 3, 5]), 90, 30)!;
    // Slots are 0, 30, 60, 90; the missing second slot leaves a gap.
    expect(geometry.line).toBe("0,30 60,15 90,0");
  });

  it("reports the direction from the first to the last drawn value", () => {
    expect(chartGeometry(series([2, 9]), 100, 40)!.trend).toBe("up");
    expect(chartGeometry(series([9, 2]), 100, 40)!.trend).toBe("down");
    expect(chartGeometry(series([null, 9, 2, null]), 100, 40)!.trend).toBe("down");
  });

  it("exposes the first and latest drawn values, ignoring gaps at the ends", () => {
    const geometry = chartGeometry(series([null, 4, 8, null]), 100, 40)!;
    expect(geometry.first).toBe(4);
    expect(geometry.latest).toBe(8);
  });

  it("closes the area polygon along the baseline", () => {
    const geometry = chartGeometry(series([0, 10]), 100, 40)!;
    expect(geometry.area).toBe("0,40 100,0 100,40 0,40");
  });

  it("marks the last drawn coordinate", () => {
    const geometry = chartGeometry(series([1, 5, null]), 100, 40)!;
    expect(geometry.last).toEqual({ x: 50, y: 0 });
  });
});

describe("barHeights", () => {
  it("scales against the busiest bucket", () => {
    expect(barHeights([0, 5, 10])).toEqual([0, 0.5, 1]);
  });

  it("returns zeros when nothing happened", () => {
    expect(barHeights([0, 0])).toEqual([0, 0]);
  });

  it("returns an empty list for an empty series", () => {
    expect(barHeights([])).toEqual([]);
  });
});
