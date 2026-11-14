import { useQuery } from "@tanstack/react-query";
import { readAgentWorkLog, type AgentWorkEntry } from "@/lib/azdoCommands";
import { ResultTab } from "@/features/pull-requests/PrSecondaryTabs";
import { WorkItemResultSection } from "@/features/work-items/WorkItemResultSection";
import { PreviewEmptyState } from "@/components/StateDisplay";
import { AgentWorkLinks } from "./AgentWorkLinks";
import { StatusBadge, timeLabel } from "./agentWorkStatus";

const actionButton =
  "rounded border border-border px-2 py-0.5 text-xs hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

export type AgentWorkActions = {
  retry: () => void;
  toggleExcluded: () => void;
  toggleLog: () => void;
  ask: () => void;
  canAsk: boolean;
  retrying: boolean;
};

function Facts({ entry }: { entry: AgentWorkEntry }) {
  const rows: [string, string][] = [];
  if (entry.startedAt) rows.push(["Started", timeLabel(entry.startedAt)]);
  if (entry.finishedAt) rows.push(["Finished", timeLabel(entry.finishedAt)]);
  if (entry.status === "waiting") rows.push(["Waiting", "Starts when the run before it finishes (one at a time)"]);
  if (entry.status === "failed") {
    if (entry.error) rows.push(["Failure", entry.error]);
    rows.push([
      "Attempts",
      `${entry.failures} failed in a row${entry.nextRetryAt ? ` · next automatic retry ${timeLabel(entry.nextRetryAt)}` : ""}`,
    ]);
  }
  if (entry.status === "partial") {
    rows.push(["Coverage", "Partial review: some material was not read. The same push is not retried automatically."]);
  }
  if (entry.exitCode !== null) rows.push(["Exit code", String(entry.exitCode)]);
  if (entry.excluded) rows.push(["Excluded", "Automatic runs skip this item, including new pushes"]);
  if (rows.length === 0) return null;
  return (
    <dl className="grid shrink-0 grid-cols-[88px_1fr] gap-x-3 gap-y-0.5 text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Log({ entry }: { entry: AgentWorkEntry }) {
  const logQuery = useQuery({
    queryKey: ["agentWorkLog", entry.organizationId, entry.target, entry.id, entry.startedAt],
    queryFn: () => readAgentWorkLog(entry),
    refetchInterval: entry.status === "running" ? 5_000 : false,
  });
  const text = logQuery.data ?? "";
  return (
    <section aria-label="Agent log" className="flex min-h-0 flex-1 flex-col gap-1">
      <p className="text-xs text-muted-foreground">Log of the latest attempt (end)</p>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-2 text-xs">
        {logQuery.isLoading ? "Loading…" : text || "No log was written."}
      </pre>
    </section>
  );
}

/**
 * The Result panel: the result HTML, with its pins and C to ask the agent
 * about a selection, like the PR Result tab and the work item Result panel.
 */
export function AgentWorkResult({ entry }: { entry: AgentWorkEntry | null }) {
  if (!entry) return <PreviewEmptyState message="Select an item to see its result." />;
  return entry.target === "pull-request" ? (
    <ResultTab selectedPr={{ pullRequestId: entry.id }} />
  ) : (
    <WorkItemResultSection workItemId={entry.id} />
  );
}

/** The Details panel: linked items, what happened, actions and the log. */
export function AgentWorkPreview({
  entry,
  showLog,
  actions,
}: {
  entry: AgentWorkEntry | null;
  showLog: boolean;
  actions: AgentWorkActions;
}) {
  if (!entry) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <PreviewEmptyState message="Nothing here." hint="Runs appear after the agent starts a review or an investigation." />
      </div>
    );
  }
  const logVisible = entry.hasLog && (showLog || entry.status === "failed" || entry.status === "running");
  const prefix = entry.target === "pull-request" ? "!" : "#";
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3 text-sm">
      <div className="shrink-0">
        <h2 className="truncate font-semibold">
          {prefix}
          {entry.id} {entry.title}
        </h2>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {entry.target === "pull-request" ? "Pull request" : "Work item"} · {entry.organizationName}
            {entry.scope ? ` · ${entry.scope}` : ""}
          </span>
          <StatusBadge status={entry.status} />
        </p>
      </div>
      <AgentWorkLinks entry={entry} />
      <Facts entry={entry} />
      <div className="flex shrink-0 flex-wrap gap-1.5">
        <button
          type="button"
          className={actionButton}
          onClick={actions.ask}
          disabled={!actions.canAsk}
          title={actions.canAsk ? "Ask the agent about this item in the Agent panel" : "The project of this pull request is unknown until it syncs again"}
        >
          Ask the agent <kbd className="text-muted-foreground">Q</kbd>
        </button>
        {entry.status === "failed" ? (
          <button type="button" className={actionButton} onClick={actions.retry} disabled={actions.retrying}>
            Retry now <kbd className="text-muted-foreground">R</kbd>
          </button>
        ) : null}
        {entry.hasLog && entry.status !== "failed" && entry.status !== "running" ? (
          <button type="button" className={actionButton} onClick={actions.toggleLog}>
            {showLog ? "Hide log" : "Show log"} <kbd className="text-muted-foreground">L</kbd>
          </button>
        ) : null}
        <button type="button" className={actionButton} onClick={actions.toggleExcluded}>
          {entry.excluded ? "Include in automatic runs" : "Exclude from automatic runs"}{" "}
          <kbd className="text-muted-foreground">{entry.excluded ? "U" : "X"}</kbd>
        </button>
      </div>
      {logVisible ? <Log entry={entry} /> : null}
    </div>
  );
}
