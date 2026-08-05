import { Loader2 } from "lucide-react";
import { commandErrorMessage } from "@/lib/azdoCommands";
import { CommitBars, DeltaBadge, TrendSparkline } from "./AnalyzeCharts";
import type { ChartPoint } from "./analyzeChartGeometry";
import { groupByBucket, type AnalyzeBucket } from "./analyzeDateRange";
import type { BranchSeries, QuerySeries } from "./useAnalyzeQueries";

export type AnalyzeSelection =
  | { kind: "query"; memberId: string }
  | { kind: "branch"; memberId: string };

function seriesPoints(series: QuerySeries): ChartPoint[] {
  return series.points.map((point, index) => ({ index, value: point.count }));
}

function drawnValues(series: QuerySeries): number[] {
  return series.points
    .map((point) => point.count)
    .filter((count): count is number => count !== null);
}

/**
 * One member of the group. The chart column is capped rather than greedy so the
 * name and the current value stay near each other on a wide window instead of
 * drifting to opposite edges.
 */
function RowShell({
  name,
  scope,
  chart,
  value,
  meta,
  onOpen,
  openLabel,
}: {
  name: string;
  scope: string;
  chart: React.ReactNode;
  value: React.ReactNode;
  meta: React.ReactNode;
  onOpen: () => void;
  openLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={openLabel}
      className="grid w-full grid-cols-[minmax(0,13rem)_minmax(0,30rem)_5rem] items-center gap-5 rounded-lg border border-border bg-card px-3.5 py-2.5 text-left hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold">{name}</span>
        <span className="truncate text-xs text-muted-foreground">{scope}</span>
      </span>
      <span className="min-w-0">{chart}</span>
      <span className="flex flex-col items-end gap-0.5">
        {value}
        {meta}
      </span>
    </button>
  );
}

export function AnalyzeSummaryPanel({
  buckets,
  querySeries,
  branchSeries,
  onOpen,
}: {
  buckets: AnalyzeBucket[];
  querySeries: QuerySeries[];
  branchSeries: BranchSeries[];
  onOpen: (selection: AnalyzeSelection) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {querySeries.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            クエリの推移
          </h3>
          {querySeries.map((series) => {
            const values = drawnValues(series);
            const latest = values.length > 0 ? values[values.length - 1] : null;
            const previous = values.length > 1 ? values[values.length - 2] : null;
            return (
              <RowShell
                key={series.memberId}
                name={series.name}
                scope={
                  series.isError
                    ? commandErrorMessage(series.error)
                    : values.length > 0
                      ? `最小 ${Math.min(...values)} / 最大 ${Math.max(...values)}`
                      : "データなし"
                }
                chart={
                  series.isError ? (
                    <span className="block text-xs text-destructive">取得に失敗しました</span>
                  ) : (
                    <TrendSparkline points={seriesPoints(series)} label={series.name} />
                  )
                }
                value={
                  <span className="flex items-center gap-1.5 text-lg font-bold tabular-nums">
                    {series.isFetching && values.length === 0 ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      (latest ?? "—")
                    )}
                  </span>
                }
                meta={
                  <DeltaBadge
                    delta={latest !== null && previous !== null ? latest - previous : null}
                  />
                }
                onOpen={() => onOpen({ kind: "query", memberId: series.memberId })}
                openLabel={`${series.name} の明細を開く`}
              />
            );
          })}
        </section>
      )}

      {branchSeries.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            ブランチのコミット
          </h3>
          {branchSeries.map((series) => {
            const grouped = groupByBucket(series.commits, buckets, (commit) => commit.authorDate);
            const counts = buckets.map((bucket) => grouped.get(bucket.key)?.length ?? 0);
            return (
              <RowShell
                key={series.memberId}
                name={series.name}
                scope={
                  series.isError
                    ? commandErrorMessage(series.error)
                    : `${series.repositoryName} · ${series.branch}`
                }
                chart={
                  series.isError ? (
                    <span className="block text-xs text-destructive">取得に失敗しました</span>
                  ) : (
                    <CommitBars counts={counts} label={series.name} />
                  )
                }
                value={
                  <span className="flex items-center gap-1.5 text-lg font-bold tabular-nums">
                    {series.isFetching && series.commits.length === 0 ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      series.commits.length
                    )}
                  </span>
                }
                meta={<span className="text-[0.7rem] text-muted-foreground">commits</span>}
                onOpen={() => onOpen({ kind: "branch", memberId: series.memberId })}
                openLabel={`${series.name} のコミット一覧を開く`}
              />
            );
          })}
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        行を選ぶとそのクエリ／ブランチの明細に移動します。
      </p>
    </div>
  );
}
