import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { commandErrorMessage } from "@/lib/azdoCommands";
import { ErrorState, LoadingState } from "@/components/StateDisplay";
import { TrendSparkline } from "./AnalyzeCharts";
import type { ChartPoint } from "./analyzeChartGeometry";
import {
  formatBucketLabel,
  groupByBucket,
  type AnalyzeBucket,
} from "./analyzeDateRange";
import type { AnalyzeGranularity } from "./analyzeGroupsStorage";
import type { BranchSeries, QuerySeries } from "./useAnalyzeQueries";

/** Buckets expanded by default, so a long window opens readable but compact. */
const DEFAULT_EXPANDED_BUCKETS = 3;

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

export function BranchDetailPanel({
  series,
  buckets,
  granularity,
}: {
  series: BranchSeries;
  buckets: AnalyzeBucket[];
  granularity: AnalyzeGranularity;
}) {
  const grouped = groupByBucket(series.commits, buckets, (commit) => commit.authorDate);
  const counts = buckets.map((bucket) => grouped.get(bucket.key)?.length ?? 0);

  // Expanding purely by recency shows an empty panel whenever the latest
  // buckets are quiet, so open the newest buckets that actually have commits.
  // Derived on every render rather than memoised: the commit array identity is
  // not a reliable signal that the counts changed.
  const populated = buckets.filter((_, index) => counts[index] > 0);
  const defaultExpanded = (populated.length > 0 ? populated : buckets)
    .slice(-DEFAULT_EXPANDED_BUCKETS)
    .map((bucket) => bucket.key);

  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  // A new window resets manual toggles so the defaults apply to it.
  const windowKey = `${buckets[0]?.key ?? ""}:${buckets.length}`;
  const lastWindowRef = useRef(windowKey);
  if (lastWindowRef.current !== windowKey) {
    lastWindowRef.current = windowKey;
    if (overrides.size > 0) setOverrides(new Map());
  }

  if (series.isError) {
    return <ErrorState message={commandErrorMessage(series.error)} />;
  }
  if (series.commits.length === 0 && series.isFetching) {
    return <LoadingState />;
  }
  const peak = counts.reduce((max, count) => Math.max(max, count), 0);
  const ordered = [...buckets].reverse();

  function isExpanded(key: string): boolean {
    return overrides.get(key) ?? defaultExpanded.includes(key);
  }

  function toggle(key: string) {
    setOverrides((current) => {
      const next = new Map(current);
      next.set(key, !isExpanded(key));
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {ordered.map((bucket) => {
        const commits = grouped.get(bucket.key) ?? [];
        const open = isExpanded(bucket.key);
        const width = peak > 0 ? (commits.length / peak) * 100 : 0;
        return (
          <div key={bucket.key} className="overflow-hidden rounded-lg border border-border bg-card">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => toggle(bucket.key)}
              className="grid w-full grid-cols-[1rem_minmax(0,9rem)_5rem_1fr] items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {open ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="text-sm font-semibold tabular-nums">
                {formatBucketLabel(bucket, granularity)}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {commits.length} commits
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-muted-foreground/60"
                  style={{ width: `${width}%` }}
                />
              </span>
            </button>

            {open && commits.length > 0 && (
              <ul className="border-t border-border">
                {commits.map((commit) => (
                  <li
                    key={commit.commitId}
                    className="grid grid-cols-[4.5rem_1fr_auto] items-baseline gap-2.5 border-b border-border/50 py-1.5 pl-9 pr-3 text-sm last:border-b-0 hover:bg-muted/40"
                  >
                    <span className="font-mono text-xs text-primary">{commit.shortCommitId}</span>
                    <span className="truncate" title={commit.comment}>
                      {commit.comment.split("\n")[0]}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{commit.authorName ?? "—"}</span>
                      {commit.webUrl && (
                        <a
                          href={commit.webUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`${commit.shortCommitId} をブラウザで開く`}
                          className="rounded p-0.5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {series.truncated && (
        <p className="pt-1 text-xs text-muted-foreground">
          Showing {series.commits.length} of {series.total} commits — 期間を狭めてください。
        </p>
      )}
    </div>
  );
}
