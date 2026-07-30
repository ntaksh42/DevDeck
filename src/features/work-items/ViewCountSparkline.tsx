import { sparklineGeometry } from './workItemViewsDisplayStorage';

const SPARKLINE_WIDTH = 100;
const SPARKLINE_HEIGHT = 24;

const TREND_CLASSES = {
  up: "text-destructive",
  down: "text-emerald-600 dark:text-emerald-400",
  flat: "text-muted-foreground",
} as const;

export type ViewCountSparklineProps = {
  points: number[];
  viewName: string;
};

/**
 * Draws the recent count history for a view. Renders nothing until there are
 * enough points to show a direction, so a freshly added view has no empty box.
 */
export function ViewCountSparkline({ points, viewName }: ViewCountSparklineProps) {
  const geometry = sparklineGeometry(points, SPARKLINE_WIDTH, SPARKLINE_HEIGHT);
  if (!geometry) return null;

  const trendLabel =
    geometry.trend === "up" ? "rising" : geometry.trend === "down" ? "falling" : "steady";

  return (
    <svg
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
      width="100%"
      height={SPARKLINE_HEIGHT}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${viewName} count trend over the last ${points.length} sessions: ${trendLabel}`}
      className={`mt-2 block ${TREND_CLASSES[geometry.trend]}`}
    >
      <polygon points={geometry.area} fill="currentColor" opacity={0.12} />
      <polyline
        points={geometry.line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={geometry.last.x} cy={geometry.last.y} r={2} fill="currentColor" />
    </svg>
  );
}
