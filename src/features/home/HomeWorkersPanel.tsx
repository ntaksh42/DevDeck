import { useState, type KeyboardEvent } from "react";
import { PreviewEmptyState } from "@/components/StateDisplay";
import { ListStatusBar, itemCount } from "@/components/ListStatusBar";
import type { HomeWorker, HomeWorkerStatus } from "@/lib/azdoCommands";
import { clamp, formatRelativeDate } from "@/lib/utils";

const STATUS_LABEL: Record<HomeWorkerStatus, string> = {
  queued: "Queued",
  running: "Running",
  needs_you: "Needs you",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

const STATUS_CLASS: Record<HomeWorkerStatus, string> = {
  queued: "text-muted-foreground",
  running: "text-info",
  needs_you: "text-destructive",
  done: "text-success",
  failed: "text-destructive",
  stopped: "text-muted-foreground",
};

export const HOME_WORKER_LIMIT = 10;

export function WorkerStatusPill({ status }: { status: HomeWorkerStatus }) {
  return (
    <span
      className={`inline-block shrink-0 whitespace-nowrap rounded-full border border-current px-1.5 text-center text-xs font-semibold ${STATUS_CLASS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function workerDetail(worker: HomeWorker): string {
  const when = worker.endedAt ?? worker.startedAt ?? worker.createdAt;
  return [worker.agent === "codex" ? "Codex" : "Claude", worker.model, formatRelativeDate(when)].filter(Boolean).join(" ・ ");
}

/**
 * Workers the Orchestrator started from this chat. Arrows move, Enter opens
 * the worker's conversation in the Agent panel, X asks to stop it inline
 * (Enter confirms, Esc cancels), Esc returns to the suggestions list.
 */
export function HomeWorkersPanel({
  workers,
  onOpen,
  onStop,
  onExit,
}: {
  workers: HomeWorker[];
  onOpen: (worker: HomeWorker) => void;
  onStop: (worker: HomeWorker) => void;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const focused = workers[clamp(index, 0, workers.length - 1)] ?? null;
  const running = workers.filter((w) => w.status === "running").length;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (confirmingId) {
      const target = workers.find((w) => w.id === confirmingId);
      if (event.key === "Enter" && target) onStop(target);
      else if (event.key !== "Escape") return;
      setConfirmingId(null);
    } else if (event.key === "ArrowDown") setIndex((i) => clamp(i + 1, 0, workers.length - 1));
    else if (event.key === "ArrowUp") setIndex((i) => clamp(i - 1, 0, workers.length - 1));
    else if (event.key === "Enter" && focused) onOpen(focused);
    else if (key === "x" && focused && (focused.status === "running" || focused.status === "queued")) {
      setConfirmingId(focused.id);
    } else if (event.key === "Escape") onExit();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="listbox"
        aria-label="Workers"
        tabIndex={0}
        data-home-workers="true"
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        {workers.length === 0 && <PreviewEmptyState message="No workers yet." hint="Ask the Orchestrator to look into something." />}
        {workers.map((worker, i) => {
          const selected = focused?.id === worker.id;
          return (
            <div
              key={worker.id}
              role="option"
              aria-selected={selected}
              onClick={() => setIndex(i)}
              onDoubleClick={() => onOpen(worker)}
              className={`grid cursor-default grid-cols-[76px_1fr_auto] items-start gap-2 border-b border-border px-3 py-1 text-sm ${
                selected ? "bg-primary/10 outline outline-2 -outline-offset-2 outline-primary" : ""
              }`}
            >
              <WorkerStatusPill status={worker.status} />
              <div className="min-w-0">
                <div className="truncate font-medium">{worker.title}</div>
                <div className="truncate text-xs text-muted-foreground">{workerDetail(worker)}</div>
                {confirmingId === worker.id ? (
                  <div role="alert" className="mt-0.5 rounded bg-destructive/10 px-1.5 text-xs text-destructive">
                    Stop this worker? Enter to stop, Esc to keep it running.
                  </div>
                ) : null}
              </div>
              <span className="text-xs tabular-nums text-link">{worker.targetLabel}</span>
            </div>
          );
        })}
      </div>
      <ListStatusBar summary={[itemCount(workers.length), `${running} running ・ ${HOME_WORKER_LIMIT} max`]}>
        <span className="text-2xs text-muted-foreground">Enter: open in Agent panel ・ X: stop</span>
      </ListStatusBar>
    </div>
  );
}
