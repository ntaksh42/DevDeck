import { commandErrorMessage } from "@/lib/azdoCommands";
import { ErrorState, LoadingState } from "@/components/StateDisplay";
import { TrendSparkline } from "./AnalyzeCharts";
import type { ChartPoint } from "./analyzeChartGeometry";
import { formatBucketLabel, type AnalyzeBucket } from "./analyzeDateRange";
import type { AnalyzeGranularity } from "./analyzeGroupsStorage";
import type { QuerySeries } from "./useAnalyzeQueries";

export function QueryDetailPanel({
  series,
  buckets,
  granularity,
}: {
  series: QuerySeries;
  buckets: AnalyzeBucket[];
  granularity: AnalyzeGranularity;
}) {
  if (series.isError) {
    return <ErrorState message={commandErrorMessage(series.error)} />;
  }
  if (series.points.length === 0 && series.isFetching) {
    return <LoadingState />;
  }

  const points: ChartPoint[] = series.points.map((point, index) => ({
    index,
    value: point.count,
  }));
  // Newest first: the recent end of the window is what gets read.
  const rows = series.points
    .map((point, index) => ({
      point,
      label: buckets[index] ? formatBucketLabel(buckets[index], granularity) : point.timestamp,
      previous: series.points[index - 1]?.count ?? null,
    }))
    .reverse();

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <TrendSparkline points={points} label={series.name} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm tabular-nums">
          <thead>
            <tr>
              <th className="border-b border-border px-2.5 py-1.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                期間
              </th>
              <th className="border-b border-border px-2.5 py-1.5 text-right text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                件数
              </th>
              <th className="border-b border-border px-2.5 py-1.5 text-right text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                前期比
              </th>
              <th className="border-b border-border px-2.5 py-1.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                備考
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ point, label, previous }) => {
              const delta =
                point.count !== null && previous !== null ? point.count - previous : null;
              return (
                <tr key={point.timestamp} className="hover:bg-muted/40">
                  <td className="whitespace-nowrap border-b border-border/60 px-2.5 py-1.5">
                    {label}
                  </td>
                  <td className="whitespace-nowrap border-b border-border/60 px-2.5 py-1.5 text-right">
                    {point.count ?? "—"}
                  </td>
                  <td
                    className={`whitespace-nowrap border-b border-border/60 px-2.5 py-1.5 text-right ${
                      delta === null
                        ? "text-muted-foreground"
                        : delta > 0
                          ? "text-destructive"
                          : delta < 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-muted-foreground"
                    }`}
                  >
                    {delta === null ? "—" : delta === 0 ? "±0" : delta > 0 ? `+${delta}` : delta}
                  </td>
                  <td className="border-b border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground">
                    {point.error ?? ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
