import { pipelineRunVisual, type RunTone } from "./pipelineStatus";

export const HISTORY_CELL_COUNT = 8;

export type HistoryCell = {
  buildId: number;
  buildNumber: string | null;
  tone: RunTone;
  label: string;
};

type RunLike = {
  buildId: number;
  buildNumber: string | null;
  status: string | null;
  result: string | null;
  queueTime: string | null;
};

/**
 * Recent runs as colored cells, oldest first so the newest sits at the right
 * edge. `runs` arrives newest first from the API.
 */
export function historyCells(runs: RunLike[], max: number = HISTORY_CELL_COUNT): HistoryCell[] {
  return runs
    .slice(0, max)
    .map((run) => {
      const visual = pipelineRunVisual(run.status, run.result);
      return { buildId: run.buildId, buildNumber: run.buildNumber, tone: visual.tone, label: visual.label };
    })
    .reverse();
}

export type BoardSort = "status" | "name" | "lastRun";
export type BoardStatusFilter = "running" | "failed" | null;

type RowLike = {
  sub: { definitionName: string };
  latest: { queueTime: string | null } | undefined;
  visual: { tone: RunTone };
};

export function isRunningRow(row: RowLike): boolean {
  return row.latest != null && row.visual.tone === "active";
}

export function isFailedRow(row: RowLike): boolean {
  return row.latest != null && row.visual.tone === "error";
}

export function filterBoardRows<T extends RowLike>(rows: T[], filter: BoardStatusFilter): T[] {
  if (filter === "running") return rows.filter(isRunningRow);
  if (filter === "failed") return rows.filter(isFailedRow);
  return rows;
}

function queueTimeMs(row: RowLike): number {
  const ms = row.latest?.queueTime ? new Date(row.latest.queueTime).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Orders the board. "status" floats running pipelines, then failed ones, to
 * the top; every mode is stable, so ties keep the watch order.
 */
export function sortBoardRows<T extends RowLike>(rows: T[], sort: BoardSort): T[] {
  const sorted = [...rows];
  if (sort === "name") {
    return sorted.sort((a, b) => a.sub.definitionName.localeCompare(b.sub.definitionName));
  }
  if (sort === "lastRun") {
    return sorted.sort((a, b) => queueTimeMs(b) - queueTimeMs(a));
  }
  const rank = (row: T) => (isRunningRow(row) ? 0 : isFailedRow(row) ? 1 : 2);
  return sorted.sort((a, b) => rank(a) - rank(b));
}

/** Run-history filters applied to every watched pipeline (the backend's BuildListCriteria). */
export type PipelineRunFilters = {
  branch: string;
  result: string;
  requestedForMe: boolean;
};

export const NO_RUN_FILTERS: PipelineRunFilters = { branch: "", result: "", requestedForMe: false };

const SORT_STORAGE_KEY = "azdodeck:view:pipelinesSort:v1";
const SORT_MODES: BoardSort[] = ["status", "name", "lastRun"];

export function loadBoardSort(): BoardSort {
  try {
    const stored = window.localStorage.getItem(SORT_STORAGE_KEY);
    return SORT_MODES.find((mode) => mode === stored) ?? "status";
  } catch {
    return "status";
  }
}

export function saveBoardSort(sort: BoardSort) {
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, sort);
  } catch {
    // Storage can be unavailable; the sort simply won't persist.
  }
}

const REASON_LABELS: Record<string, string> = {
  individualci: "CI",
  batchedci: "CI",
  pullrequest: "PR",
  manual: "Manual",
  schedule: "Schedule",
  scheduled: "Schedule",
  triggered: "Triggered",
  resourcetrigger: "Resource",
  buildcompletion: "Build",
};

/** Short label for a build's trigger reason ("individualCI" -> "CI"). */
export function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return "—";
  return REASON_LABELS[reason.toLowerCase()] ?? reason;
}
