// Maps a sampled count series onto an SVG viewBox.
//
// Unlike the work item view sparkline, a point here can be missing (Azure
// DevOps could not answer for that instant). Missing points are skipped so the
// line bridges the gap rather than dropping to zero, which would read as "the
// bugs were all closed that day".

export type ChartPoint = {
  index: number;
  value: number | null;
};

export type ChartGeometry = {
  /** `points` attribute for the polyline. */
  line: string;
  /** `points` attribute for the filled area below the line. */
  area: string;
  last: { x: number; y: number };
  min: number;
  max: number;
  first: number;
  latest: number;
  trend: "up" | "down" | "flat";
};

export function chartGeometry(
  points: ChartPoint[],
  width: number,
  height: number,
): ChartGeometry | null {
  const drawn = points.filter(
    (point): point is { index: number; value: number } => point.value !== null,
  );
  // A single point has no direction to show and cannot form a line.
  if (drawn.length < 2 || points.length < 2) return null;

  const values = drawn.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const stepX = width / (points.length - 1);

  const coordinates = drawn.map((point) => {
    const x = round(point.index * stepX);
    // A flat series sits on the middle rather than pinned to an edge, which is
    // what a min===max normalisation would otherwise produce.
    const ratio = span === 0 ? 0.5 : (point.value - min) / span;
    return { x, y: round(height - ratio * height) };
  });

  const first = values[0];
  const latest = values[values.length - 1];
  const lastCoordinate = coordinates[coordinates.length - 1];

  return {
    line: coordinates.map(({ x, y }) => `${x},${y}`).join(" "),
    area: [
      ...coordinates.map(({ x, y }) => `${x},${y}`),
      `${lastCoordinate.x},${height}`,
      `${coordinates[0].x},${height}`,
    ].join(" "),
    last: lastCoordinate,
    min,
    max,
    first,
    latest,
    trend: latest > first ? "up" : latest < first ? "down" : "flat",
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Heights (0-1) for a bar series, scaled against the busiest bucket. */
export function barHeights(counts: number[]): number[] {
  const max = counts.reduce((peak, count) => Math.max(peak, count), 0);
  if (max <= 0) return counts.map(() => 0);
  return counts.map((count) => count / max);
}
