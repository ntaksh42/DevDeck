import { formatBucketLabel, type AnalyzeBucket } from "./analyzeDateRange";
import { milestoneTargetOn, type AnalyzeMilestone } from "./analyzeMilestones";
import { valueWithPrevious } from "./analyzeChartLayout";
import type { AnalyzeGranularity } from "./analyzeGroupsStorage";

export type LegendEntry = {
  memberId: string;
  name: string;
  color: string;
  /** Null marks a bucket the value is not known for. */
  values: (number | null)[];
  kind: "query" | "branch";
};

/**
 * Toggling a series here hides it from the chart without unregistering it, so
 * a crowded group can be read a couple of lines at a time.
 */
export function AnalyzeChartLegend({
  entries,
  hidden,
  onToggle,
  cursor,
}: {
  entries: LegendEntry[];
  hidden: ReadonlySet<string>;
  onToggle: (memberId: string) => void;
  cursor: number | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="系列の表示">
      {entries.map((entry) => {
        const visible = !hidden.has(entry.memberId);
        const index = cursor ?? entry.values.length - 1;
        const value = entry.values[index] ?? null;
        return (
          <button
            key={entry.memberId}
            type="button"
            aria-pressed={visible}
            onClick={() => onToggle(entry.memberId)}
            className={`flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              visible ? "" : "opacity-50"
            }`}
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-sm"
              style={{ backgroundColor: visible ? entry.color : "hsl(var(--muted-foreground))" }}
            />
            <span className="max-w-[9rem] truncate">{entry.name}</span>
            <span className="tabular-nums text-muted-foreground">{value ?? "—"}</span>
          </button>
        );
      })}
    </div>
  );
}

export type TooltipSeries = LegendEntry & { milestones: AnalyzeMilestone[] };

/**
 * Every visible series at the hovered bucket, so the reading is one glance
 * rather than one hover per line.
 */
export function AnalyzeChartTooltip({
  bucket,
  granularity,
  series,
  cursor,
}: {
  bucket: AnalyzeBucket;
  granularity: AnalyzeGranularity;
  series: TooltipSeries[];
  cursor: number;
}) {
  return (
    <div className="pointer-events-none flex min-w-[11rem] flex-col gap-0.5 rounded-md border border-border bg-card p-2 text-xs shadow-md">
      <p className="pb-0.5 font-semibold tabular-nums">
        {formatBucketLabel(bucket, granularity)}
      </p>
      {series.map((entry) => {
        const { value, previous } = valueWithPrevious(entry.values, cursor);
        const delta = value !== null && previous !== null ? value - previous : null;
        const target = milestoneTargetOn(entry.milestones, bucket.key);
        const gap = value !== null && target !== null ? value - target : null;
        return (
          <div key={entry.memberId} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-sm"
                style={{ backgroundColor: entry.color }}
              />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{entry.name}</span>
              <span className="font-semibold tabular-nums">{value ?? "欠測"}</span>
              {delta !== null && delta !== 0 && (
                <span
                  className={`tabular-nums ${
                    // Only a query count carries a good/bad direction; commit
                    // volume is just volume.
                    entry.kind === "branch"
                      ? "text-muted-foreground"
                      : delta > 0
                        ? "text-destructive"
                        : "text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  {delta > 0 ? "+" : ""}
                  {delta}
                </span>
              )}
            </div>
            {gap !== null && (
              <p className="pl-3 text-[0.68rem] text-muted-foreground tabular-nums">
                目標 {target?.toFixed(1)}（
                <span className={gap > 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}>
                  {gap > 0 ? "+" : ""}
                  {gap.toFixed(1)}
                </span>
                ）
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
