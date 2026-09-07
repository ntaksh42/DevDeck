import { useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  axisTicks,
  chartLayout,
  lastDrawnIndex,
  lineRuns,
} from "./analyzeChartLayout";
import { formatBucketLabel, isWeekendBucket, type AnalyzeBucket } from "./analyzeDateRange";
import { milestoneTargets, type AnalyzeMilestone } from "./analyzeMilestones";
import type { AnalyzeGranularity } from "./analyzeGroupsStorage";

export type ChartLineSeries = {
  memberId: string;
  name: string;
  color: string;
  values: (number | null)[];
  milestones: AnalyzeMilestone[];
};

export type ChartBarSeries = {
  memberId: string;
  name: string;
  color: string;
  counts: number[];
};

export type AnalyzeCombinedChartProps = {
  buckets: AnalyzeBucket[];
  granularity: AnalyzeGranularity;
  lines: ChartLineSeries[];
  bars: ChartBarSeries[];
  /** Bucket index under the shared cursor, or null when nothing is hovered. */
  cursor: number | null;
  onCursorChange: (index: number | null) => void;
};

function seriesMax(values: (number | null)[][]): number {
  let max = 0;
  for (const series of values) {
    for (const value of series) {
      if (value !== null && value > max) max = value;
    }
  }
  return max;
}

/**
 * The group's whole window on one time axis: query counts as lines against the
 * left axis, commit volume as bars against the right one.
 *
 * Bars sit behind the lines because they are context for the level, not the
 * subject of it.
 */
export function AnalyzeCombinedChart({
  buckets,
  granularity,
  lines,
  bars,
  cursor,
  onCursorChange,
}: AnalyzeCombinedChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const lineMax = seriesMax([
    ...lines.map((series) => series.values),
    // A target above every actual still has to fit on the axis.
    ...lines.map((series) => milestoneTargets(series.milestones, buckets)),
  ]);
  const barMax = seriesMax(bars.map((series) => series.counts));
  const layout = chartLayout(buckets.length, lineMax, barMax);
  const { padding, plotHeight, bandWidth } = layout;
  const plotBottom = padding.top + plotHeight;

  const indexFromClientX = useCallback(
    (clientX: number): number | null => {
      const svg = svgRef.current;
      if (!svg || buckets.length === 0) return null;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return null;
      const local = ((clientX - rect.left) / rect.width) * layout.width;
      const index = Math.floor((local - padding.left) / bandWidth);
      if (index < 0 || index >= buckets.length) return null;
      return index;
    },
    [buckets.length, bandWidth, layout.width, padding.left],
  );

  /**
   * The cursor has to be reachable without a pointer, so the same reading the
   * tooltip gives on hover is available from the keyboard.
   */
  function handleKeyDown(event: ReactKeyboardEvent<SVGSVGElement>) {
    if (buckets.length === 0) return;
    const last = buckets.length - 1;
    // Entering from the keyboard starts at the newest bucket, which is the one
    // being read in practice.
    const current = cursor ?? last;
    let next: number | null = null;
    switch (event.key) {
      case "ArrowLeft":
        next = Math.max(0, current - 1);
        break;
      case "ArrowRight":
        next = Math.min(last, current + 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      case "Escape":
        // Nothing to clear: let the pane handle Escape as it normally would.
        if (cursor === null) return;
        next = null;
        break;
      default:
        return;
    }
    // Movement keys belong to the chart: the surrounding pane also listens for
    // them, and the group list must not scroll underneath.
    event.preventDefault();
    event.stopPropagation();
    onCursorChange(next);
  }

  if (buckets.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        表示する期間がありません。
      </p>
    );
  }

  const countTicks = axisTicks(layout.countMax);
  const volumeTicks = bars.length > 0 ? axisTicks(layout.volumeMax) : [];
  // Label only the ends and middle: a 90-day window cannot show every date.
  const labelIndexes = [0, Math.floor((buckets.length - 1) / 2), buckets.length - 1].filter(
    (value, index, all) => all.indexOf(value) === index,
  );

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width="100%"
      preserveAspectRatio="none"
      role="img"
      tabIndex={0}
      aria-label={
        `${lines.length} 件のクエリの推移と ${bars.length} 件のブランチのコミットを同じ期間で重ねたチャート。` +
        `矢印キーで期間を移動できます。` +
        (cursor !== null && buckets[cursor]
          ? ` 現在 ${formatBucketLabel(buckets[cursor], granularity)}。`
          : "")
      }
      className="block h-[15rem] touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onKeyDown={handleKeyDown}
      onPointerMove={(event) => onCursorChange(indexFromClientX(event.clientX))}
      onPointerLeave={() => onCursorChange(null)}
    >
      {/* A6 — weekends shaded so a weekday rhythm is visible at a glance. */}
      {granularity === "day" &&
        buckets.map((bucket, index) =>
          isWeekendBucket(bucket) ? (
            <rect
              key={`weekend-${bucket.key}`}
              x={padding.left + index * bandWidth}
              y={padding.top}
              width={bandWidth}
              height={plotHeight}
              className="fill-muted-foreground/10"
            />
          ) : null,
        )}

      {/* A2 — left axis: the count scale the query lines are drawn against. */}
      {countTicks.map((tick) => (
        <g key={`count-${tick}`}>
          <line
            x1={padding.left}
            y1={layout.yCount(tick)}
            x2={layout.width - padding.right}
            y2={layout.yCount(tick)}
            className="stroke-border"
            strokeWidth={1}
          />
          <text
            x={padding.left - 5}
            y={layout.yCount(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-muted-foreground text-[9px] tabular-nums"
          >
            {tick}
          </text>
        </g>
      ))}

      {/* A2 — right axis: commit volume, kept off the count scale. */}
      {volumeTicks.map((tick) => (
        <text
          key={`volume-${tick}`}
          x={layout.width - padding.right + 5}
          y={layout.yVolume(tick)}
          dominantBaseline="middle"
          className="fill-muted-foreground text-[9px] tabular-nums"
        >
          {tick}
        </text>
      ))}

      {labelIndexes.map((index) => (
        <text
          key={`date-${buckets[index].key}`}
          x={layout.xAt(index)}
          y={layout.height - 8}
          textAnchor={index === 0 ? "start" : index === buckets.length - 1 ? "end" : "middle"}
          className="fill-muted-foreground text-[9px] tabular-nums"
        >
          {formatBucketLabel(buckets[index], granularity)}
        </text>
      ))}

      {/* B4 — commit bars share the time axis with the lines above them. */}
      {bars.map((series, seriesIndex) => {
        const slot = bandWidth / (bars.length + 0.6);
        return (
          <g key={series.memberId} fill={series.color} opacity={0.35}>
            {series.counts.map((count, index) => {
              if (count <= 0) return null;
              const height = Math.max(plotBottom - layout.yVolume(count), 1.5);
              return (
                <rect
                  key={buckets[index]?.key ?? index}
                  x={padding.left + index * bandWidth + slot * seriesIndex + slot * 0.3}
                  y={plotBottom - height}
                  width={Math.max(slot * 0.85, 0.8)}
                  height={height}
                  rx={1}
                />
              );
            })}
          </g>
        );
      })}

      {/* F3 — milestone target polyline, drawn under the actuals. */}
      {lines.map((series) => {
        const targets = milestoneTargets(series.milestones, buckets);
        const drawn = targets
          .map((target, index) =>
            target === null ? null : `${layout.xAt(index)},${layout.yCount(target)}`,
          )
          .filter((point): point is string => point !== null);
        if (drawn.length < 2) return null;
        return (
          <polyline
            key={`target-${series.memberId}`}
            points={drawn.join(" ")}
            fill="none"
            stroke={series.color}
            strokeWidth={1.2}
            strokeDasharray="5 3"
            opacity={0.65}
          />
        );
      })}

      {/* B1 — every query line on one chart, A4 dashing across missing points. */}
      {lines.map((series) => {
        const runs = lineRuns(series.values);
        const lastIndex = lastDrawnIndex(series.values);
        return (
          <g key={series.memberId}>
            {runs.slice(0, -1).map((run, runIndex) => {
              const from = run[run.length - 1];
              const to = runs[runIndex + 1][0];
              return (
                <line
                  key={`gap-${from.index}`}
                  x1={layout.xAt(from.index)}
                  y1={layout.yCount(from.value)}
                  x2={layout.xAt(to.index)}
                  y2={layout.yCount(to.value)}
                  stroke={series.color}
                  strokeWidth={1.6}
                  strokeDasharray="3 3"
                  opacity={0.55}
                />
              );
            })}
            {runs.map((run) => (
              <polyline
                key={`run-${run[0].index}`}
                points={run
                  .map((point) => `${layout.xAt(point.index)},${layout.yCount(point.value)}`)
                  .join(" ")}
                fill="none"
                stroke={series.color}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {/* A4 — hollow points bracket a gap, so it reads as unsampled. */}
            {runs.slice(0, -1).flatMap((run, runIndex) => {
              const from = run[run.length - 1];
              const to = runs[runIndex + 1][0];
              return [from, to].map((point) => (
                <circle
                  key={`edge-${point.index}`}
                  cx={layout.xAt(point.index)}
                  cy={layout.yCount(point.value)}
                  r={2.5}
                  className="fill-card"
                  stroke={series.color}
                  strokeWidth={1.5}
                />
              ));
            })}
            {/* A5 — the current value sits on the line, not only in the table. */}
            {lastIndex >= 0 && (
              <>
                <circle
                  cx={layout.xAt(lastIndex)}
                  cy={layout.yCount(series.values[lastIndex] as number)}
                  r={3}
                  fill={series.color}
                />
                <text
                  x={layout.xAt(lastIndex) - 5}
                  y={layout.yCount(series.values[lastIndex] as number) - 6}
                  textAnchor="end"
                  fill={series.color}
                  className="text-[10px] font-bold tabular-nums"
                >
                  {series.values[lastIndex]}
                </text>
              </>
            )}
          </g>
        );
      })}

      {/* A1 — the shared cursor every panel on screen reads from. */}
      {cursor !== null && buckets[cursor] && (
        <g>
          <line
            x1={layout.xAt(cursor)}
            y1={padding.top}
            x2={layout.xAt(cursor)}
            y2={plotBottom}
            className="stroke-foreground/40"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          {lines.map((series) => {
            const value = series.values[cursor];
            if (value === null || value === undefined) return null;
            return (
              <circle
                key={`cursor-${series.memberId}`}
                cx={layout.xAt(cursor)}
                cy={layout.yCount(value)}
                r={3.5}
                fill={series.color}
                className="stroke-card"
                strokeWidth={1.5}
              />
            );
          })}
        </g>
      )}
    </svg>
  );
}

/** Tracks the hovered bucket for the panels that share one time axis. */
export function useSharedCursor(bucketCount: number) {
  const [cursor, setCursor] = useState<number | null>(null);
  // A shorter window must not leave the cursor pointing past the end.
  if (cursor !== null && cursor >= bucketCount) setCursor(null);
  return [cursor, setCursor] as const;
}
