import { historyCells, type HistoryCell } from "./pipelineBoard";
import type { PipelineRunSummary } from "@/lib/azdoCommands";
import type { RunTone } from "./pipelineStatus";

const CELL_CLASS: Record<RunTone, string> = {
  success: "bg-emerald-500",
  error: "bg-red-500",
  warning: "bg-amber-500",
  active: "animate-pulse bg-blue-500",
  canceled: "bg-zinc-400",
  neutral: "bg-zinc-300 dark:bg-zinc-600",
};

// Recent runs as small colored cells (oldest left, newest right), so repeated
// failures show at a glance without expanding the pipeline. Clicking a cell
// selects that run; the expanded grid is the keyboard path to the same runs.
export function PipelineHistorySpark({
  runs,
  onSelect,
}: {
  runs: PipelineRunSummary[];
  onSelect: (cell: HistoryCell) => void;
}) {
  const cells = historyCells(runs);
  if (cells.length === 0) return null;
  return (
    <span className="inline-flex shrink-0 items-end gap-0.5" role="group" aria-label="Recent runs">
      {cells.map((cell) => (
        <button
          key={cell.buildId}
          type="button"
          tabIndex={-1}
          onClick={() => onSelect(cell)}
          title={`${cell.buildNumber ?? cell.buildId}: ${cell.label}`}
          aria-label={`Run ${cell.buildNumber ?? cell.buildId}: ${cell.label}`}
          className={`h-3.5 w-1.5 rounded-sm hover:opacity-70 ${CELL_CLASS[cell.tone]}`}
        />
      ))}
    </span>
  );
}
