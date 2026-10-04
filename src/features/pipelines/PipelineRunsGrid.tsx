import { ExternalLink } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { PipelineRunSummary } from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { formatDate, formatRelativeDate } from "@/lib/utils";
import { reasonLabel } from "./pipelineBoard";
import { RunBadge } from "./PipelineRunBadge";
import { formatDuration, pipelineRunVisual, shortBranch } from "./pipelineStatus";

export type RunSelection = {
  organizationId: string;
  projectId: string;
  definitionId: number;
  buildId: number;
};

// Narrow keeps the original six columns; wide (enough panel width) adds who
// queued the run and why.
const NARROW_COLUMNS = "grid-cols-[104px_96px_minmax(100px,1fr)_88px_72px_28px]";
const WIDE_COLUMNS = "grid-cols-[104px_96px_minmax(100px,1fr)_110px_72px_88px_72px_28px]";

export function PipelineRunsGrid({
  label,
  runs,
  definitionId,
  selectedBuildId,
  isPrimary,
  wide,
  onSelectRun,
}: {
  label: string;
  runs: PipelineRunSummary[];
  definitionId: number;
  selectedBuildId: number | null;
  isPrimary: boolean;
  wide: boolean;
  onSelectRun: (selection: RunSelection) => void;
}) {
  // Roving tabindex: the selected run is the Tab entry point, falling back to
  // the first row when the selection is in another pipeline.
  const selectedRunIndex = runs.findIndex((run) => run.buildId === selectedBuildId);
  const tabbableRunIndex = selectedRunIndex >= 0 ? selectedRunIndex : 0;

  function select(run: PipelineRunSummary) {
    onSelectRun({
      organizationId: run.organizationId,
      projectId: run.projectId,
      definitionId,
      buildId: run.buildId,
    });
  }

  // Arrow / j-k navigation across the run rows of one expanded pipeline.
  function handleRunKeyDown(event: ReactKeyboardEvent) {
    const target = event.target as HTMLElement;
    const rowEl = target.closest('[role="row"]') as HTMLElement | null;
    if (!rowEl) return;
    const grid = event.currentTarget as HTMLElement;
    const rowEls = Array.from(grid.querySelectorAll<HTMLElement>('[role="row"]'));
    const current = rowEls.indexOf(rowEl);

    // Ctrl/Cmd+Enter opens the focused run in the browser, mirroring the row's
    // Open button.
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && current >= 0) {
      event.preventDefault();
      event.stopPropagation();
      const run = runs[current];
      if (run?.webUrl) void openExternalUrl(run.webUrl).catch(() => {});
      return;
    }
    // Ignore the Open button and any other modified chords.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();

    let nextIndex = current;
    if (event.key === "ArrowDown" || key === "j") {
      nextIndex = Math.min(current + 1, rowEls.length - 1);
    } else if (event.key === "ArrowUp" || key === "k") {
      nextIndex = Math.max(current - 1, 0);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = rowEls.length - 1;
    } else if (event.key === "Enter" && current >= 0) {
      event.preventDefault();
      event.stopPropagation();
      select(runs[current]);
      return;
    } else {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    rowEls[nextIndex]?.focus();
  }

  return (
    <div
      role="grid"
      aria-label={label}
      data-primary-grid={isPrimary ? "true" : undefined}
      className="overflow-x-auto bg-muted/20 pl-6 outline-none"
      onKeyDown={handleRunKeyDown}
    >
      <div className={wide ? "min-w-[860px]" : "min-w-[640px]"}>
        {runs.map((run, runIndex) => {
          const runVisual = pipelineRunVisual(run.status, run.result);
          const selected = run.buildId === selectedBuildId;
          return (
            <div
              key={run.buildId}
              role="row"
              tabIndex={runIndex === tabbableRunIndex ? 0 : -1}
              aria-selected={selected}
              onClick={() => select(run)}
              className={`grid h-[28px] w-full cursor-pointer select-none ${
                wide ? WIDE_COLUMNS : NARROW_COLUMNS
              } items-center gap-2 border-b border-border/60 px-2 text-left text-sm outline-none last:border-b-0 focus:ring-2 focus:ring-inset focus:ring-ring ${
                selected ? "bg-secondary" : "hover:bg-muted/50"
              }`}
            >
              <RunBadge visual={runVisual} />
              <span className="truncate font-mono text-xs text-muted-foreground">
                {run.buildNumber ?? run.buildId}
              </span>
              <span className="truncate text-xs text-muted-foreground" title={run.sourceBranch ?? undefined}>
                {shortBranch(run.sourceBranch)}
              </span>
              {wide ? (
                <span className="truncate text-xs text-muted-foreground" title={run.requestedFor ?? undefined}>
                  {run.requestedFor ?? "—"}
                </span>
              ) : null}
              {wide ? (
                <span className="truncate text-xs text-muted-foreground" title={run.reason ?? undefined}>
                  {reasonLabel(run.reason)}
                </span>
              ) : null}
              <span
                className="truncate text-xs text-muted-foreground"
                title={run.queueTime ? formatDate(run.queueTime) : undefined}
              >
                {run.queueTime ? formatRelativeDate(run.queueTime) : "—"}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {formatDuration(run.startTime, run.finishTime)}
              </span>
              <button
                type="button"
                disabled={!run.webUrl}
                onClick={(event) => {
                  event.stopPropagation();
                  void openExternalUrl(run.webUrl).catch(() => {});
                }}
                title="Open run in browser"
                aria-label={`Open run ${run.buildNumber ?? run.buildId} in browser`}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
