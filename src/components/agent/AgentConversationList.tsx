import { noteNeedsYou, type AgentNote } from "@/lib/azdoCommands";
import { formatRelativeDate } from "@/lib/utils";
import { pendingProposals } from "./agentProposals";
import type { Conversation } from "./useAgentPanelData";

const KIND_LABELS: Record<string, string> = {
  investigate: "Investigate",
  summarize: "Summarize",
  question: "Question",
  fix: "Fix",
  redo: "Redo",
};

export function lastActivity(note: AgentNote): string {
  return note.replies[note.replies.length - 1]?.createdAt ?? note.createdAt;
}

/** The conversation's state as a pill, where a PR thread shows Active / Resolved. */
export function AgentStatus({ note }: { note: AgentNote }) {
  const [tone, label] = noteNeedsYou(note)
    ? ["border-destructive/30 bg-destructive/10 text-destructive", "Needs you"]
    : note.status === "draft"
      ? ["border-dashed border-border text-muted-foreground", "Draft"]
      : note.status === "done"
        ? ["border-border bg-muted text-muted-foreground", "Done"]
        : ["border-warning/30 bg-warning/10 text-warning", "Open"];
  return <span className={`shrink-0 rounded border px-1.5 text-2xs leading-4 ${tone}`}>{label}</span>;
}

/** What a conversation is about, its kind, last activity and counts, as one muted line. */
export function conversationMeta(note: AgentNote): string {
  const kind = note.kind ? (KIND_LABELS[note.kind] ?? note.kind) : null;
  const proposals = pendingProposals(note).length;
  return [
    note.context,
    kind,
    formatRelativeDate(lastActivity(note)),
    note.replies.length ? `${note.replies.length} ${note.replies.length === 1 ? "reply" : "replies"}` : null,
    proposals ? `${proposals} to post` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The conversations as rows of two lines: the request's first line with its
 * state, then what it is about and how recent it is. Enter (or a click) opens
 * one; the panel moves focus between rows with the arrow keys.
 */
export function AgentConversationList({
  conversations,
  selectedKey,
  rowRef,
  onOpen,
  onFocusRow,
}: {
  conversations: Conversation[];
  selectedKey: string | null;
  rowRef: (key: string, el: HTMLButtonElement | null) => void;
  onOpen: (c: Conversation) => void;
  onFocusRow: (c: Conversation) => void;
}) {
  let doneShown = false;
  return (
    <>
      {conversations.map((c) => {
        const done = c.note.status === "done";
        const divider = done && !doneShown;
        if (done) doneShown = true;
        const selected = c.key === selectedKey;
        return (
          <div key={c.key}>
            {divider ? <p className="px-1.5 pb-0.5 pt-2 text-2xs text-muted-foreground">Done</p> : null}
            <button
              ref={(el) => rowRef(c.key, el)}
              type="button"
              tabIndex={selected ? 0 : -1}
              data-agent-conversation={c.note.id}
              aria-current={selected ? "true" : undefined}
              onClick={() => onOpen(c)}
              onFocus={() => onFocusRow(c)}
              className={`block w-full min-w-0 rounded border px-1.5 py-1 text-left outline-none hover:bg-accent/60 focus-visible:ring-1 focus-visible:ring-ring ${
                selected ? "border-primary/50 bg-primary/5" : "border-transparent"
              } ${done ? "text-muted-foreground" : ""}`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className={`min-w-0 flex-1 truncate text-[13px] ${noteNeedsYou(c.note) ? "font-semibold text-foreground" : ""}`}
                  title={c.note.body}
                >
                  {c.note.body.split("\n")[0]}
                </span>
                <AgentStatus note={c.note} />
              </span>
              <span className="block truncate text-2xs text-muted-foreground">{conversationMeta(c.note)}</span>
            </button>
          </div>
        );
      })}
    </>
  );
}
