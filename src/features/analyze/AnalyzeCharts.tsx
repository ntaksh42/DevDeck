import { barHeights, chartGeometry, type ChartPoint } from "./analyzeChartGeometry";

const TREND_CLASSES = {
  // A rising query count is the bad direction (more open bugs), matching the
  // work item view sparkline so the two never contradict each other.
  up: "text-destructive",
  down: "text-emerald-600 dark:text-emerald-400",
  flat: "text-muted-foreground",
} as const;

const CHART_WIDTH = 300;
const CHART_HEIGHT = 44;

export function TrendSparkline({
  points,
  label,
}: {
  points: ChartPoint[];
  label: string;
}) {
  const geometry = chartGeometry(points, CHART_WIDTH, CHART_HEIGHT);
  if (!geometry) {
    return (
      <span className="block text-xs text-muted-foreground">
        推移を描くにはデータ点が足りません
      </span>
    );
  }

  const direction =
    geometry.trend === "up" ? "増加" : geometry.trend === "down" ? "減少" : "横ばい";

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      width="100%"
      height={CHART_HEIGHT}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label}: ${geometry.first} から ${geometry.latest} へ${direction} (最小 ${geometry.min} / 最大 ${geometry.max})`}
      className={`block ${TREND_CLASSES[geometry.trend]}`}
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
      <circle cx={geometry.last.x} cy={geometry.last.y} r={2.5} fill="currentColor" />
    </svg>
  );
}

/**
 * Commit volume per bucket. Bars rather than a line because commits are a
 * count of things that happened, not a level that persists between buckets.
 */
export function CommitBars({
  counts,
  label,
  highlight = null,
}: {
  counts: number[];
  label: string;
  /** Bucket under the shared cursor; falls back to the latest one. */
  highlight?: number | null;
}) {
  const heights = barHeights(counts);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const marked = highlight ?? heights.length - 1;

  return (
    <span
      className="flex h-11 items-end gap-[2px]"
      role="img"
      aria-label={`${label}: ${counts.length} 区間で合計 ${total} コミット`}
    >
      {heights.map((height, index) => (
        <span
          key={index}
          className={`block flex-1 rounded-t-[1px] ${
            index === marked ? "bg-primary" : "bg-muted-foreground/50"
          }`}
          // A zero-commit bucket keeps a hairline so the gap stays visible.
          style={{ height: `${Math.max(height * 100, counts[index] > 0 ? 6 : 2)}%` }}
        />
      ))}
    </span>
  );
}

export function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-xs text-muted-foreground">—</span>;
  if (delta === 0) return <span className="text-xs text-muted-foreground">±0</span>;
  const rising = delta > 0;
  return (
    <span
      className={`text-xs tabular-nums ${
        rising ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
      }`}
    >
      {rising ? "▲" : "▼"}
      {Math.abs(delta)}
    </span>
  );
}
