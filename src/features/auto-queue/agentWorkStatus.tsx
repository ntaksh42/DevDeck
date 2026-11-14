import type { AgentWorkEntry, AgentWorkStatus } from "@/lib/azdoCommands";
import type { AgentSubject } from "@/components/agent/agentSubject";

/**
 * What the Agent panel is about while an entry is selected, so follow-up
 * questions land in that PR's / work item's own conversation. A pull request
 * whose project is unknown (an old history the sync no longer has) has none.
 */
export function agentWorkSubject(entry: AgentWorkEntry): AgentSubject | null {
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
  id: "active" | "attention" | "results" | "excluded" | "candidates";
  label: string;
  matches: (entry: AgentWorkEntry) => boolean;
};

export const TABS: AgentWorkTab[] = [
  { id: "attention", label: "Needs attention", matches: (e) => e.status === "failed" || e.status === "partial" },
  { id: "active", label: "Active", matches: (e) => e.status === "running" || e.status === "waiting" },
  { id: "results", label: "Results", matches: (e) => e.status === "succeeded" },
  { id: "excluded", label: "Excluded", matches: (e) => e.excluded },
  { id: "candidates", label: "Candidates", matches: () => false },
];

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
