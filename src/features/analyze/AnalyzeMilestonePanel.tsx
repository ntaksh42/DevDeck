import { useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { isoDate, type AnalyzeBucket } from "./analyzeDateRange";
import {
  milestoneStatus,
  suggestNextMilestone,
  type AnalyzeMilestone,
  type MilestoneStatus,
} from "./analyzeMilestones";
import { MAX_ANALYZE_MILESTONES } from "./analyzeGroupsStorage";
import type { QuerySeries } from "./useAnalyzeQueries";

const STATUS_STYLES: Record<MilestoneStatus["kind"], string> = {
  met: "text-emerald-600 dark:text-emerald-400",
  missed: "text-destructive",
  ahead: "text-emerald-600 dark:text-emerald-400",
  behind: "text-amber-600 dark:text-amber-400",
  pending: "text-muted-foreground",
  unknown: "text-muted-foreground",
};

const STATUS_LABELS: Record<MilestoneStatus["kind"], string> = {
  met: "達成",
  missed: "未達",
  ahead: "前倒し",
  behind: "遅延",
  pending: "予定",
  unknown: "不明",
};

function statusNote(status: MilestoneStatus, target: number): string {
  switch (status.kind) {
    case "met":
      return `実績 ${status.actual}（目標 ${target}）`;
    case "missed":
      return `実績 ${status.actual} / 目標 ${target} → ${status.delta} 件超過`;
    case "ahead":
    case "behind":
      return `現在 ${status.actual} / ペース ${status.pace.toFixed(1)}`;
    case "unknown":
      return "その日の実績が取れていません";
    default:
      return "";
  }
}

/**
 * "By this date, get to this count", as many times as the plan needs.
 *
 * The target line these produce starts at the first milestone and holds flat
 * after the last, so it never moves when the displayed range changes.
 */
export function AnalyzeMilestonePanel({
  series,
  buckets,
  onChange,
}: {
  series: QuerySeries;
  buckets: AnalyzeBucket[];
  onChange: (milestones: AnalyzeMilestone[]) => void;
}) {
  const addRef = useRef<HTMLButtonElement | null>(null);
  const counts = series.points.map((point) => point.count);
  const today = isoDate(new Date());
  const atLimit = series.milestones.length >= MAX_ANALYZE_MILESTONES;

  function update(index: number, patch: Partial<AnalyzeMilestone>) {
    onChange(
      series.milestones.map((milestone, position) =>
        position === index ? { ...milestone, ...patch } : milestone,
      ),
    );
  }

  function remove(index: number) {
    onChange(series.milestones.filter((_, position) => position !== index));
    addRef.current?.focus();
  }

  function add() {
    const lastBucket = buckets[buckets.length - 1];
    const fallbackCount = counts.filter((count): count is number => count !== null).pop() ?? 0;
    onChange([
      ...series.milestones,
      suggestNextMilestone(
        series.milestones,
        lastBucket ? lastBucket.key : today,
        fallbackCount,
      ),
    ]);
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          マイルストーン
        </h3>
        <span className="text-[0.7rem] text-muted-foreground tabular-nums">
          {series.milestones.length} / {MAX_ANALYZE_MILESTONES}
        </span>
      </div>

      {series.milestones.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          「その日までに何件にするか」を登録すると、目標の推移が線で表示されます。
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {series.milestones.map((milestone, index) => {
            const status = milestoneStatus(
              milestone,
              series.milestones,
              buckets,
              counts,
              today,
            );
            return (
              <li
                key={`${milestone.date}-${index}`}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1.5"
              >
                <span className="w-8 shrink-0 text-[0.7rem] font-semibold text-muted-foreground tabular-nums">
                  MS{index + 1}
                </span>
                <input
                  type="date"
                  value={milestone.date}
                  aria-label={`MS${index + 1} の日付`}
                  onChange={(event) => {
                    if (event.target.value) update(index, { date: event.target.value });
                  }}
                  className="rounded-md border border-border bg-card px-1.5 py-0.5 text-xs tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <input
                  type="number"
                  min={0}
                  value={milestone.count}
                  aria-label={`MS${index + 1} の目標件数`}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next) && next >= 0) update(index, { count: next });
                  }}
                  className="w-16 rounded-md border border-border bg-card px-1.5 py-0.5 text-xs tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span
                  className={`shrink-0 rounded-full border border-current px-1.5 py-0 text-[0.68rem] font-semibold ${STATUS_STYLES[status.kind]}`}
                >
                  {STATUS_LABELS[status.kind]}
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.7rem] text-muted-foreground">
                  {statusNote(status, milestone.count)}
                </span>
                <button
                  type="button"
                  aria-label={`MS${index + 1} を削除`}
                  onClick={() => remove(index)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <button
        ref={addRef}
        type="button"
        onClick={add}
        disabled={atLimit}
        className="flex w-fit items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
        マイルストーンを追加
      </button>
    </section>
  );
}
