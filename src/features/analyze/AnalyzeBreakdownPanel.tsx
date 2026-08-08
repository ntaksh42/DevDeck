import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { commandErrorMessage } from "@/lib/azdoCommands";
import type { WorkItemSummary } from "@/lib/azdoCommands";
import { ErrorState, LoadingState } from "@/components/StateDisplay";
import {
  buildBreakdown,
  BREAKDOWN_AXIS_LABELS,
  type BreakdownAxis,
} from "./analyzeBreakdown";

/** Axes offered in the UI, in the order they are most often reached for. */
const AXES: BreakdownAxis[] = ["assignedTo", "state", "workItemType"];

/**
 * Who holds what, right now.
 *
 * A horizontal bar per value, longest first — the labels are names, which read
 * far better along the y axis than rotated under a column chart.
 */
export function AnalyzeBreakdownPanel({
  items,
  truncated,
  isFetching,
  isError,
  error,
  hasQueries,
  axis,
  onAxisChange,
}: {
  items: WorkItemSummary[];
  truncated: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  hasQueries: boolean;
  axis: BreakdownAxis;
  onAxisChange: (axis: BreakdownAxis) => void;
}) {
  const [focusIndex, setFocusIndex] = useState(0);
  const breakdown = useMemo(() => buildBreakdown(items, axis), [items, axis]);

  if (!hasQueries) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        内訳を出すにはグループにクエリを登録してください。
      </p>
    );
  }
  if (isError) return <ErrorState message={commandErrorMessage(error)} />;
  if (items.length === 0 && isFetching) return <LoadingState />;

  const peak = breakdown.slices[0]?.count ?? 0;

  function handleKeyDown(event: ReactKeyboardEvent<HTMLUListElement>) {
    let handled = true;
    switch (event.key) {
      case "ArrowDown":
      case "j":
      case "J":
        setFocusIndex((current) => Math.min(current + 1, breakdown.slices.length - 1));
        break;
      case "ArrowUp":
      case "k":
      case "K":
        setFocusIndex((current) => Math.max(current - 1, 0));
        break;
      case "Home":
        setFocusIndex(0);
        break;
      case "End":
        setFocusIndex(breakdown.slices.length - 1);
        break;
      default:
        handled = false;
    }
    if (handled) {
      // Keep row movement here so the surrounding pane does not also act on it.
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            現在の内訳
          </h3>
          <span className="text-xs tabular-nums text-muted-foreground">
            {breakdown.total} 件 / {breakdown.distinctCount} {BREAKDOWN_AXIS_LABELS[axis]}
          </span>
        </div>

        {AXES.length > 1 && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            軸
            <select
              aria-label="集計軸"
              value={axis}
              onChange={(event) => {
                onAxisChange(event.target.value as BreakdownAxis);
                // The new axis has different rows, so start from the top again.
                setFocusIndex(0);
              }}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {AXES.map((value) => (
                <option key={value} value={value}>
                  {BREAKDOWN_AXIS_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {breakdown.slices.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          対象の作業項目がありません。
        </p>
      ) : (
        <ul
          className="flex flex-col gap-1 focus:outline-none"
          aria-label={`${BREAKDOWN_AXIS_LABELS[axis]}別の内訳`}
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          {breakdown.slices.map((slice, index) => (
            <li
              key={slice.key}
              aria-current={index === focusIndex ? "true" : undefined}
              className={`grid grid-cols-[minmax(0,9rem)_1fr_3.5rem_3rem] items-center gap-2.5 rounded-md border px-2.5 py-1.5 ${
                index === focusIndex ? "border-primary bg-muted/40" : "border-transparent"
              }`}
            >
              <span
                className={`truncate text-sm ${
                  slice.isOther ? "italic text-muted-foreground" : "font-medium"
                }`}
                title={slice.key}
              >
                {slice.key}
              </span>
              <span className="h-2.5 overflow-hidden rounded-full bg-muted">
                <span
                  className={`block h-full rounded-full ${
                    slice.isOther ? "bg-muted-foreground/50" : "bg-primary"
                  }`}
                  // Scaled against the largest slice, not the total, so a flat
                  // distribution still fills the row and stays comparable.
                  style={{ width: `${peak > 0 ? (slice.count / peak) * 100 : 0}%` }}
                />
              </span>
              <span className="text-right text-sm font-semibold tabular-nums">
                {slice.count}
              </span>
              <span className="text-right text-xs tabular-nums text-muted-foreground">
                {Math.round(slice.ratio * 100)}%
              </span>
            </li>
          ))}
        </ul>
      )}

      {truncated && (
        <p className="text-xs text-destructive">
          取得上限に達したため、一部の作業項目のみの内訳です。クエリを絞り込んでください。
        </p>
      )}
    </div>
  );
}
