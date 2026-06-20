import { useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { commitActivity, commandErrorMessage, type CommitActivityInput } from "@/lib/azdoCommands";
import { ErrorState, LoadingState } from "@/components/StateDisplay";

// Calendar runs Monday (top) to Sunday (bottom), matching the issue's 月〜日 axis.
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DEFAULT_WINDOW_DAYS = 90;

type HeatCell = {
  date: string;
  count: number;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

// Monday = 0 ... Sunday = 6.
function mondayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Builds week columns (each a Mon..Sun array of 7 day-cells, possibly null for
 * padding) covering [start, end]. The most-recent week is rightmost so the grid
 * reads like GitHub's contribution calendar.
 */
function buildWeeks(
  start: Date,
  end: Date,
  counts: Map<string, number>,
): (HeatCell | null)[][] {
  // Align the grid to the Monday on/before `start` so each column is a full week.
  const gridStart = startOfUtcDay(start);
  gridStart.setUTCDate(gridStart.getUTCDate() - mondayIndex(gridStart));
  const gridEnd = startOfUtcDay(end);

  const weeks: (HeatCell | null)[][] = [];
  const cursor = new Date(gridStart);
  let current: (HeatCell | null)[] = [];
  while (cursor <= gridEnd) {
    if (cursor < start) {
      current.push(null);
    } else {
      const date = isoDate(cursor);
      current.push({ date, count: counts.get(date) ?? 0 });
    }
    if (current.length === 7) {
      weeks.push(current);
      current = [];
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (current.length > 0) {
    while (current.length < 7) current.push(null);
    weeks.push(current);
  }
  return weeks;
}

// Empty days use the lightest cell so zero-commit days remain visible per spec.
function cellClass(count: number, max: number): string {
  if (count <= 0) return "bg-muted";
  if (max <= 0) return "bg-green-100 dark:bg-green-900";
  const ratio = count / max;
  if (ratio <= 0.25) return "bg-green-200 dark:bg-green-800";
  if (ratio <= 0.5) return "bg-green-300 dark:bg-green-700";
  if (ratio <= 0.75) return "bg-green-500 dark:bg-green-600";
  return "bg-green-700 dark:bg-green-400";
}

function formatTooltip(cell: HeatCell): string {
  return `${cell.count}件 (${cell.date})`;
}

export function CommitActivityHeatmap({
  organizationId,
  author,
  fromDate,
  toDate,
  projectId,
  repositoryId,
}: {
  organizationId: string;
  author: string;
  fromDate: string;
  toDate: string;
  projectId: string;
  repositoryId: string;
}) {
  const input: CommitActivityInput = {
    organizationId,
    author: author || undefined,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    projectId: projectId || undefined,
    repositoryId: repositoryId || undefined,
  };

  const activityQuery = useQuery({
    queryKey: [
      "commitActivity",
      organizationId,
      author,
      fromDate,
      toDate,
      projectId,
      repositoryId,
    ],
    queryFn: () => commitActivity(input),
    enabled: !!organizationId,
    staleTime: 60_000,
  });

  const { start, end } = useMemo(() => {
    const endDate = toDate ? new Date(`${toDate}T00:00:00Z`) : new Date();
    const startDate = fromDate
      ? new Date(`${fromDate}T00:00:00Z`)
      : new Date(endDate.getTime() - (DEFAULT_WINDOW_DAYS - 1) * 86_400_000);
    return { start: startOfUtcDay(startDate), end: startOfUtcDay(endDate) };
  }, [fromDate, toDate]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const day of activityQuery.data ?? []) {
      map.set(day.date, day.count);
    }
    return map;
  }, [activityQuery.data]);

  const weeks = useMemo(() => buildWeeks(start, end, counts), [start, end, counts]);
  const max = useMemo(() => {
    let value = 0;
    for (const count of counts.values()) value = Math.max(value, count);
    return value;
  }, [counts]);
  const total = useMemo(() => {
    let value = 0;
    for (const count of counts.values()) value += count;
    return value;
  }, [counts]);

  const cellRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

  useEffect(() => {
    cellRefs.current.clear();
  }, [weeks]);

  function moveFocus(weekIndex: number, dayIndex: number) {
    const week = weeks[weekIndex];
    const cell = week?.[dayIndex];
    if (!cell) return;
    const el = cellRefs.current.get(cell.date);
    el?.focus();
  }

  function handleCellKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    weekIndex: number,
    dayIndex: number,
  ) {
    let handled = true;
    switch (event.key) {
      case "ArrowRight":
        moveFocus(weekIndex + 1, dayIndex);
        break;
      case "ArrowLeft":
        moveFocus(weekIndex - 1, dayIndex);
        break;
      case "ArrowDown":
        moveFocus(weekIndex, dayIndex + 1);
        break;
      case "ArrowUp":
        moveFocus(weekIndex, dayIndex - 1);
        break;
      default:
        handled = false;
    }
    if (handled) {
      // Keep navigation inside the heatmap so the host view does not also react.
      event.preventDefault();
      event.stopPropagation();
    }
  }

  if (activityQuery.isLoading) {
    return <LoadingState />;
  }
  if (activityQuery.isError) {
    return <ErrorState message={commandErrorMessage(activityQuery.error)} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Activity</h2>
        <span className="text-sm text-muted-foreground">
          {total} commit{total === 1 ? "" : "s"} · {isoDate(start)} – {isoDate(end)}
        </span>
      </div>

      <div className="flex gap-2">
        <div
          className="grid shrink-0 gap-1 pt-[18px] text-[10px] leading-none text-muted-foreground"
          aria-hidden="true"
        >
          {WEEKDAY_LABELS.map((label, index) => (
            <div key={label} className="flex h-3 items-center">
              {index % 2 === 1 ? label : ""}
            </div>
          ))}
        </div>

        <div className="overflow-x-auto">
          <div
            role="grid"
            aria-label="Commit activity heatmap"
            className="flex gap-1 outline-none"
          >
            {weeks.map((week, weekIndex) => (
              <div key={weekIndex} role="row" className="flex flex-col gap-1">
                {week.map((cell, dayIndex) =>
                  cell ? (
                    <button
                      key={cell.date}
                      ref={(el) => {
                        cellRefs.current.set(cell.date, el);
                      }}
                      type="button"
                      role="gridcell"
                      aria-label={formatTooltip(cell)}
                      title={formatTooltip(cell)}
                      onKeyDown={(event) => handleCellKeyDown(event, weekIndex, dayIndex)}
                      className={`h-3 w-3 rounded-[2px] focus:outline-none focus:ring-2 focus:ring-ring ${cellClass(
                        cell.count,
                        max,
                      )}`}
                    />
                  ) : (
                    <div key={`pad-${weekIndex}-${dayIndex}`} className="h-3 w-3" aria-hidden="true" />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1 text-[10px] text-muted-foreground">
        <span>Less</span>
        <span className="h-3 w-3 rounded-[2px] bg-muted" />
        <span className="h-3 w-3 rounded-[2px] bg-green-200 dark:bg-green-800" />
        <span className="h-3 w-3 rounded-[2px] bg-green-300 dark:bg-green-700" />
        <span className="h-3 w-3 rounded-[2px] bg-green-500 dark:bg-green-600" />
        <span className="h-3 w-3 rounded-[2px] bg-green-700 dark:bg-green-400" />
        <span>More</span>
      </div>
    </div>
  );
}
