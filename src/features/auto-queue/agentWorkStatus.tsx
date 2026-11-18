import type { AgentWorkEntry, AgentWorkStatus } from "@/lib/azdoCommands";
import type { AgentSubject } from "@/components/agent/agentSubject";

/**
 * What the Agent panel is about while an entry is selected, so follow-up
 * questions land in that PR's / work item's own conversation. A pull request
 * whose project is unknown (an old history the sync no longer has) has none.
 */
export function agentWorkSubject(entry: AgentWorkEntry): AgentSubject | null {
  if (entry.target === "pipeline") return null;
  if (entry.target === "work-item") {
    return {
      kind: "work-item",
      id: entry.id,
      title: entry.title,
      organizationId: entry.organizationId,
      projectId: entry.scopeId,
      webUrl: entry.webUrl,
    };
  }
  if (!entry.projectId) return null;
  return {
    kind: "pull-request",
    id: entry.id,
    title: entry.title,
    organizationId: entry.organizationId,
    projectId: entry.projectId,
    repositoryId: entry.scopeId,
    repositoryName: entry.scope,
    webUrl: entry.webUrl,
  };
}

export const STATUS_LABEL: Record<AgentWorkStatus, string> = {
  waiting: "Waiting",
  running: "Running",
  failed: "Failed",
  partial: "Partial",
  succeeded: "Done",
  none: "Not run",
};

const STATUS_CLASS: Record<AgentWorkStatus, string> = {
  waiting: "text-muted-foreground",
  running: "text-primary",
  failed: "text-destructive",
  partial: "text-warning",
  succeeded: "text-success",
  none: "text-muted-foreground border-dashed",
};

export function StatusBadge({ status }: { status: AgentWorkStatus }) {
  return (
    <span className={`inline-block rounded-full border border-current px-1.5 text-center text-xs font-semibold ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export type AgentWorkTab = {
  id: "runs" | "candidates";
  label: string;
  matches: (entry: AgentWorkEntry) => boolean;
};

// Candidates first: it is where manual runs start. Runs is for follow-up.
export const TABS: AgentWorkTab[] = [
  { id: "candidates", label: "Candidates", matches: () => false },
  { id: "runs", label: "Runs", matches: () => true },
];

export const needsAttention = (entry: AgentWorkEntry) => entry.status === "failed" || entry.status === "partial";

/**
 * Runs order: what needs a decision first, then running / waiting, then
 * results, and items excluded from automatic runs last. Read state does not
 * affect the order, so a row does not jump while it is being read. The sort is
 * stable, so each group keeps the order the backend returned.
 */
export function sortRuns(entries: AgentWorkEntry[]): AgentWorkEntry[] {
  const rank = (entry: AgentWorkEntry) => {
    if (entry.excluded) return 4;
    if (needsAttention(entry)) return 0;
    if (entry.status === "running" || entry.status === "waiting") return 1;
    if (entry.status === "succeeded") return 2;
    return 3;
  };
  return entries
    .map((entry, index) => ({ entry, index, rank: rank(entry) }))
    .sort((x, y) => x.rank - y.rank || x.index - y.index)
    .map((x) => x.entry);
}

/** "4m ago", "in 34m", "3h ago", "2d ago". */
export function timeLabel(iso: string | null, now = Date.now()): string {
  const time = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(time)) return "";
  const minutes = Math.round((time - now) / 60_000);
  const size = Math.abs(minutes);
  const text = size < 1 ? "now" : size < 60 ? `${size}m` : size < 48 * 60 ? `${Math.round(size / 60)}h` : `${Math.round(size / 1440)}d`;
  if (text === "now") return text;
  return minutes > 0 ? `in ${text}` : `${text} ago`;
}
