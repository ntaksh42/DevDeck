import {
  granularityLabel,
  rangeOptions,
  type AnalyzeGranularity,
  type AnalyzeGroup,
  type AnalyzeRangePreset,
} from "./analyzeGroupsStorage";

const GRANULARITIES: { value: AnalyzeGranularity; label: string; key: string }[] = [
  { value: "day", label: "Day", key: "D" },
  { value: "week", label: "Week", key: "W" },
  { value: "month", label: "Month", key: "M" },
];

const PRESETS: { value: AnalyzeRangePreset; label: string }[] = [
  { value: "count", label: "直近" },
  { value: "thisMonth", label: "今月" },
  { value: "lastMonth", label: "先月" },
  { value: "custom", label: "カスタム" },
];

export function AnalyzeRangeControls({
  group,
  onGranularityChange,
  onPatch,
}: {
  group: AnalyzeGroup;
  onGranularityChange: (granularity: AnalyzeGranularity) => void;
  onPatch: (patch: Partial<AnalyzeGroup>) => void;
}) {
  const unit = granularityLabel(group.granularity);

  return (
    <>
      <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="粒度">
        {GRANULARITIES.map(({ value, label, key }) => (
          <button
            key={value}
            type="button"
            aria-pressed={group.granularity === value}
            title={`${label}（${key}）`}
            onClick={() => onGranularityChange(value)}
            className={`px-2.5 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
              group.granularity === value
                ? "bg-secondary font-semibold"
                : "bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <select
        aria-label="期間の種類"
        value={group.rangePreset}
        onChange={(event) =>
          onPatch({ rangePreset: event.target.value as AnalyzeRangePreset })
        }
        className="rounded-md border border-border bg-card px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {PRESETS.map((preset) => (
          <option key={preset.value} value={preset.value}>
            {preset.label}
          </option>
        ))}
      </select>

      {group.rangePreset === "count" && (
        <select
          aria-label="期間"
          value={group.rangeCount}
          onChange={(event) => onPatch({ rangeCount: Number(event.target.value) })}
          className="rounded-md border border-border bg-card px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {rangeOptions(group.granularity).map((option) => (
            <option key={option} value={option}>
              直近 {option} {unit}
            </option>
          ))}
        </select>
      )}

      {group.rangePreset === "custom" && (
        <div className="flex items-center gap-1">
          <input
            type="date"
            aria-label="開始日"
            value={group.rangeFrom}
            onChange={(event) => onPatch({ rangeFrom: event.target.value })}
            className="rounded-md border border-border bg-card px-1.5 py-1 text-xs tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <input
            type="date"
            aria-label="終了日"
            value={group.rangeTo}
            onChange={(event) => onPatch({ rangeTo: event.target.value })}
            className="rounded-md border border-border bg-card px-1.5 py-1 text-xs tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      )}
    </>
  );
}

/**
 * G5 — the view's shortcuts, written down. They were previously only in the
 * key handler, which made them undiscoverable.
 */
export function AnalyzeShortcutHints({ hasSelection }: { hasSelection: boolean }) {
  const hints: [string, string][] = [
    ["D / W / M", "粒度"],
    ["[ / ]", "期間"],
    ["↑ / ↓", "行移動"],
    ["Enter", "明細"],
    ["← / →", "チャートの期間"],
  ];
  if (hasSelection) hints.push(["Esc", "一覧へ"]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted/30 px-4 py-1 text-[0.7rem] text-muted-foreground">
      {hints.map(([keys, label]) => (
        <span key={keys} className="flex items-center gap-1">
          <kbd className="rounded border border-border border-b-2 bg-muted/60 px-1 py-px font-mono text-[0.65rem]">
            {keys}
          </kbd>
          {label}
        </span>
      ))}
    </div>
  );
}
