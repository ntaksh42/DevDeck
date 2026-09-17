import { AnalyzeChartLegend, AnalyzeChartTooltip, type LegendEntry } from "./AnalyzeChartLegend";
import {
  AnalyzeCombinedChart,
  type ChartBarSeries,
  type ChartLineSeries,
} from "./AnalyzeCombinedChart";
import { AnalyzeSummaryPanel, type AnalyzeSelection } from "./AnalyzeSummaryPanel";
import { groupByBucket, type AnalyzeBucket } from "./analyzeDateRange";
import type { AnalyzeGranularity } from "./analyzeGroupsStorage";
import type { AnalyzeMilestone } from "./analyzeMilestones";
import type { BranchSeries, QuerySeries } from "./useAnalyzeQueries";

export type AnalyzeTrendPanelProps = {
  buckets: AnalyzeBucket[];
  granularity: AnalyzeGranularity;
  querySeries: QuerySeries[];
  branchSeries: BranchSeries[];
  lines: ChartLineSeries[];
  bars: ChartBarSeries[];
  legendEntries: (LegendEntry & { milestones: AnalyzeMilestone[] })[];
  hidden: ReadonlySet<string>;
  onToggleSeries: (memberId: string) => void;
  cursor: number | null;
  onCursorChange: (index: number | null) => void;
  onOpen: (selection: AnalyzeSelection) => void;
};

/** The chart plus the per-member rows that read from the same shared cursor. */
export function AnalyzeTrendPanel({
  buckets,
  granularity,
  querySeries,
  branchSeries,
  lines,
  bars,
  legendEntries,
  hidden,
  onToggleSeries,
  cursor,
  onCursorChange,
  onOpen,
}: AnalyzeTrendPanelProps) {
  // Driven by what the group holds, not by what is currently visible: hiding
  // the last series must leave the legend on screen to toggle it back.
  const hasChart = legendEntries.length > 0;
  const visibleSeries = legendEntries.filter((entry) => !hidden.has(entry.memberId));

  // The commits behind the bar the cursor sits on. Hidden branches are left out
  // so the tooltip never reports work the chart is not currently drawing.
  const cursorCommits =
    cursor !== null && buckets[cursor]
      ? branchSeries
          .filter((series) => !hidden.has(series.memberId))
          .flatMap(
            (series) =>
              groupByBucket(series.commits, buckets, (commit) => commit.authorDate).get(
                buckets[cursor].key,
              ) ?? [],
          )
      : [];

  return (
    <>
      {hasChart && (
        <section className="rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              推移
            </h3>
            <AnalyzeChartLegend
              entries={legendEntries}
              hidden={hidden}
              onToggle={onToggleSeries}
              cursor={cursor}
            />
          </div>
          <div className="relative p-3">
            <AnalyzeCombinedChart
              buckets={buckets}
              granularity={granularity}
              lines={lines}
              bars={bars}
              cursor={cursor}
              onCursorChange={onCursorChange}
            />
            {cursor !== null && buckets[cursor] && (
              <div
                className="pointer-events-none absolute top-4"
                style={{
                  // Follow the cursor but stay inside the panel.
                  left: `clamp(0.5rem, ${
                    ((cursor + 0.5) / Math.max(1, buckets.length)) * 100
                  }%, calc(100% - 12rem))`,
                }}
              >
                <AnalyzeChartTooltip
                  bucket={buckets[cursor]}
                  granularity={granularity}
                  series={visibleSeries}
                  cursor={cursor}
                  commits={cursorCommits}
                  commitTotal={cursorCommits.length}
                />
              </div>
            )}
          </div>
        </section>
      )}

      <AnalyzeSummaryPanel
        buckets={buckets}
        querySeries={querySeries}
        branchSeries={branchSeries}
        cursor={cursor}
        onOpen={onOpen}
      />
    </>
  );
}
