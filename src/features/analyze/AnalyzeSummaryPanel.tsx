import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Loader2 } from "lucide-react";
import { commandErrorMessage } from "@/lib/azdoCommands";
import { CommitBars, DeltaBadge, TrendSparkline } from "./AnalyzeCharts";
import type { ChartPoint } from "./analyzeChartGeometry";
import { valueWithPrevious } from "./analyzeChartLayout";
import { branchSeriesColor, querySeriesColor } from "./analyzeColors";
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

type Row = {
  key: string;
  selection: AnalyzeSelection;
  name: string;
  scope: string;
  color: string;
  chart: React.ReactNode;
  value: React.ReactNode;
  meta: React.ReactNode;
};

/**
 * One member of the group. The chart column is capped rather than greedy so the
 * name and the current value stay near each other on a wide window instead of
 * drifting to opposite edges.
 */
function RowShell({
  row,
  focused,
  onOpen,
  onKeyDown,
  registerRef,
}: {
  row: Row;
  focused: boolean;
  onOpen: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  registerRef: (element: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={registerRef}
      type="button"
      onClick={onOpen}
      onKeyDown={onKeyDown}
      tabIndex={focused ? 0 : -1}
      aria-label={`${row.name} の明細を開く`}
      className={`grid w-full grid-cols-[minmax(0,13rem)_minmax(0,30rem)_5rem] items-center gap-5 rounded-lg border bg-card px-3.5 py-2.5 text-left hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        focused ? "border-primary" : "border-border"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: row.color }}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">{row.name}</span>
          <span className="truncate text-xs text-muted-foreground">{row.scope}</span>
        </span>
      </span>
      <span className="min-w-0">{row.chart}</span>
      <span className="flex flex-col items-end gap-0.5">
        {row.value}
        {row.meta}
      </span>
    </button>
  );
}

export function AnalyzeSummaryPanel({
  buckets,
  querySeries,
  branchSeries,
  cursor,
  onOpen,
}: {
  buckets: AnalyzeBucket[];
  querySeries: QuerySeries[];
  branchSeries: BranchSeries[];
  /** Bucket the shared chart cursor sits on, or null for the latest value. */
  cursor: number | null;
  onOpen: (selection: AnalyzeSelection) => void;
}) {
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // State rather than a ref: the focused row is styled, so a move has to
  // re-render for the highlight to follow.
  const [focusIndex, setFocusIndex] = useState(0);

  const queryRows: Row[] = querySeries.map((series, index) => {
    const values = drawnValues(series);
    const counts = series.points.map((point) => point.count);
    const at = cursor ?? counts.length - 1;
    const { value, previous } = valueWithPrevious(counts, at);
    return {
      key: series.memberId,
      selection: { kind: "query", memberId: series.memberId },
      name: series.name,
      color: querySeriesColor(index),
      scope: series.isError
        ? commandErrorMessage(series.error)
        : values.length > 0
          ? `最小 ${Math.min(...values)} / 最大 ${Math.max(...values)}`
          : "データなし",
      chart: series.isError ? (
        <span className="block text-xs text-destructive">取得に失敗しました</span>
      ) : (
        <TrendSparkline points={seriesPoints(series)} label={series.name} />
      ),
      value: (
        <span className="flex items-center gap-1.5 text-lg font-bold tabular-nums">
          {series.isFetching && values.length === 0 ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            (value ?? "—")
          )}
        </span>
      ),
      meta: (
        <DeltaBadge delta={value !== null && previous !== null ? value - previous : null} />
      ),
    };
  });

  const branchRows: Row[] = branchSeries.map((series, index) => {
    const grouped = groupByBucket(series.commits, buckets, (commit) => commit.authorDate);
    const counts = buckets.map((bucket) => grouped.get(bucket.key)?.length ?? 0);
    const at = cursor ?? counts.length - 1;
    const shown = cursor === null ? series.commits.length : (counts[at] ?? 0);
    return {
      key: series.memberId,
      selection: { kind: "branch", memberId: series.memberId },
      name: series.name,
      color: branchSeriesColor(index),
      scope: series.isError
        ? commandErrorMessage(series.error)
        : `${series.repositoryName} · ${series.branch}`,
      chart: series.isError ? (
        <span className="block text-xs text-destructive">取得に失敗しました</span>
      ) : (
        <CommitBars counts={counts} label={series.name} highlight={cursor} />
      ),
      value: (
        <span className="flex items-center gap-1.5 text-lg font-bold tabular-nums">
          {series.isFetching && series.commits.length === 0 ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            shown
          )}
        </span>
      ),
      meta: <span className="text-[0.7rem] text-muted-foreground">commits</span>,
    };
  });

  const rows = [...queryRows, ...branchRows];

  useEffect(() => {
    rowRefs.current.length = rows.length;
    // A shorter list must not leave the roving tabindex past the end.
    setFocusIndex((current) => Math.min(current, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  function focusAt(index: number) {
    const clamped = Math.max(0, Math.min(index, rows.length - 1));
    setFocusIndex(clamped);
    rowRefs.current[clamped]?.focus();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    let handled = true;
    switch (event.key) {
      case "ArrowDown":
      case "j":
      case "J":
        focusAt(index + 1);
        break;
      case "ArrowUp":
      case "k":
      case "K":
        focusAt(index - 1);
        break;
      case "Home":
        focusAt(0);
        break;
      case "End":
        focusAt(rows.length - 1);
        break;
      default:
        handled = false;
    }
    if (handled) {
      // Keep navigation here so the surrounding pane does not also react.
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function renderSection(title: string, sectionRows: Row[], offset: number) {
    if (sectionRows.length === 0) return null;
    return (
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {sectionRows.map((row, index) => {
          const absolute = offset + index;
          return (
            <RowShell
              key={row.key}
              row={row}
              focused={absolute === focusIndex}
              registerRef={(element) => {
                rowRefs.current[absolute] = element;
              }}
              onOpen={() => onOpen(row.selection)}
              onKeyDown={(event) => handleKeyDown(event, absolute)}
            />
          );
        })}
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {renderSection("クエリの推移", queryRows, 0)}
      {renderSection("ブランチのコミット", branchRows, queryRows.length)}

      <p className="text-xs text-muted-foreground">
        行を選ぶとそのクエリ／ブランチの明細に移動します（<kbd>↑</kbd> <kbd>↓</kbd> で移動、
        <kbd>Enter</kbd> で開く）。
      </p>
    </div>
  );
}
