import { MessageSquareText } from "lucide-react";
import type { AgentNoteTarget } from "@/lib/azdoCommands";
import { isItemUnread } from "./noteSeen";
import { useAgentNoteSummary, useSeenVersion } from "./useAgentNoteSummaries";

// Grid-row badge: open agent notes on the item, red when a note waits for the
// user, bold when an agent replied since the notes were last opened.
export function AgentNotesBadge({ target, itemId }: { target: AgentNoteTarget; itemId: number }) {
  const summary = useAgentNoteSummary(target, itemId);
  useSeenVersion();
  if (!summary || (!summary.open && !summary.drafts)) return null;
  const unread = isItemUnread({ target, itemId }, summary.lastAgentReplyAt);
  const needs = summary.needsYou > 0;
  const label = [
    `${summary.open} open agent note${summary.open === 1 ? "" : "s"}`,
    needs ? `${summary.needsYou} waiting for you` : null,
    summary.drafts ? `${summary.drafts} draft${summary.drafts === 1 ? "" : "s"}` : null,
    unread ? "new agent reply" : null,
  ].filter(Boolean).join(" · ");
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded border px-1 text-[11px] leading-4 ${
        needs
          ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          : "border-border bg-muted text-muted-foreground"
      } ${unread ? "font-bold" : ""}`}
    >
      <MessageSquareText className="h-3 w-3" aria-hidden="true" />
      {summary.open || summary.drafts}
    </span>
  );
}
