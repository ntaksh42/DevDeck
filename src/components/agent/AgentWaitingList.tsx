import { navigateToPullRequest, navigateToWorkItem } from "@/lib/crossLinks";
import { useAgentWaiting, type AgentWaiting } from "@/components/agent-notes/useAgentWaiting";
import { openAgentPanel } from "./agentSubject";

function labelOf(waiting: AgentWaiting): string {
  if (waiting.kind === "pull-request") return `Pull request !${waiting.id}`;
  if (waiting.kind === "work-item") return `Work item #${waiting.id}`;
  return "Request";
}

/**
 * Conversations waiting for the user in other pull requests, work items and
 * requests than the one the panel shows, so none is missed after moving on.
 * Choosing one opens that item (or request) and the panel follows it.
 */
export function AgentWaitingList({ shownKeys }: { shownKeys: ReadonlySet<string> }) {
  const waiting = useAgentWaiting().filter((entry) => !shownKeys.has(`${entry.kind}:${entry.id}`));
  if (waiting.length === 0) return null;

  function open(entry: AgentWaiting) {
    if (entry.kind === "pull-request") navigateToPullRequest({ pullRequestId: entry.id });
    else if (entry.kind === "work-item") navigateToWorkItem({ workItemId: entry.id });
    else openAgentPanel({ askId: entry.id, reply: true });
  }

  return (
    <section aria-label="Waiting for you elsewhere" className="shrink-0 border-b border-border px-2 py-1">
      <p className="text-[11px] font-medium text-muted-foreground">Waiting for you elsewhere</p>
      <ul className="flex flex-wrap gap-1 pt-1">
        {waiting.map((entry) => (
          <li key={`${entry.kind}:${entry.id}`}>
            <button
              type="button"
              onClick={() => open(entry)}
              className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-ring dark:border-red-800 dark:bg-red-950/50 dark:text-red-300"
            >
              {labelOf(entry)}
              {entry.kind === "ask" ? ` ${entry.id}` : ""}
              <span className="font-semibold">{entry.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
