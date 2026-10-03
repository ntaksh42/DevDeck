// Layout for the combined analyze chart: query counts as lines against a left
// axis, commit volume as bars against a right one, both on the same time axis.
//
// Kept separate from analyzeChartGeometry.ts, which stays the small sparkline
// mapper used by the summary rows.

export type ChartPadding = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export const CHART_VIEWBOX = { width: 720, height: 260 } as const;

export const CHART_PADDING: ChartPadding = {
  left: 34,
  right: 34,
  top: 16,
  bottom: 26,
};

export type ChartLayout = {
  width: number;
  height: number;
  padding: ChartPadding;
  plotWidth: number;
  plotHeight: number;
  bucketCount: number;
  /** Centre x of a bucket, so a line point sits mid-band like its bar. */
  xAt: (index: number) => number;
  /** Full width of one bucket's band. */
  bandWidth: number;
  /** y for a value on the left (count) axis. */
  yCount: (value: number) => number;
  /** y for a value on the right (commit) axis. */
  yVolume: (value: number) => number;
  countMax: number;
  volumeMax: number;
};

export function chartLayout(
  bucketCount: number,
  countMax: number,
  volumeMax: number,
  padding: ChartPadding = CHART_PADDING,
  viewBox = CHART_VIEWBOX,
): ChartLayout {
  const plotWidth = viewBox.width - padding.left - padding.right;
  const plotHeight = viewBox.height - padding.top - padding.bottom;
  const count = Math.max(1, bucketCount);
  const bandWidth = plotWidth / count;
  // Never divide by zero, and give a flat-zero series a sane axis.
  const safeCount = countMax > 0 ? countMax : 1;
  const safeVolume = volumeMax > 0 ? volumeMax : 1;

  return {
    width: viewBox.width,
    height: viewBox.height,
    padding,
    plotWidth,
    plotHeight,
    bucketCount: count,
    bandWidth,
    xAt: (index) => padding.left + (index + 0.5) * bandWidth,
    yCount: (value) => padding.top + plotHeight - (value / safeCount) * plotHeight,
    yVolume: (value) => padding.top + plotHeight - (value / safeVolume) * plotHeight,
    countMax: safeCount,
    volumeMax: safeVolume,
  };
}

/**
 * Axis ticks at a round interval, always including zero and never overshooting
 * the top of the axis.
 */
export function axisTicks(max: number, target = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const rough = max / Math.max(1, target);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / magnitude;
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;

  const ticks: number[] = [];
  for (let value = 0; value <= max + step / 1000; value += step) {
    ticks.push(Math.round(value * 100) / 100);
  }
  return ticks;
}

export type LineRun = { index: number; value: number }[];

/**
 * Splits a nullable series into unbroken runs.
 *
 * Each run is drawn solid; the caller bridges consecutive runs with a dashed
 * segment so a gap reads as "not sampled" rather than as a real drop.
 */
export function lineRuns(values: (number | null)[]): LineRun[] {
  const runs: LineRun[] = [];
  let current: LineRun = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length > 0) runs.push(current);
      current = [];
      return;
    }
    current.push({ index, value });
  });
  if (current.length > 0) runs.push(current);
  return runs;
}

/** Index of the last non-null value, or -1 when the series is empty. */
export function lastDrawnIndex(values: (number | null)[]): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] !== null) return index;
  }
  return -1;
}

/** The value at `index`, and the most recent one before it, for a delta. */
export function valueWithPrevious(
  values: (number | null)[],
  index: number,
): { value: number | null; previous: number | null } {
  const value = values[index] ?? null;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = values[cursor];
    if (candidate !== null && candidate !== undefined) {
      return { value, previous: candidate };
    }
  }
  return { value, previous: null };
}
