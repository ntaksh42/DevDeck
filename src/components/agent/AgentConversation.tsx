import { forwardRef } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { noteNeedsYou, type AgentNote } from "@/lib/azdoCommands";
import { NoteMarkdown } from "@/components/agent-notes/NoteMarkdown";
import { formatRelativeDate } from "@/lib/utils";

const KIND_LABELS: Record<string, string> = {
  investigate: "Investigate",
  summarize: "Summarize",
  question: "Question",
  fix: "Fix",
  redo: "Redo",
};

/**
 * One message of a conversation: the user's request or a reply. No box of
 * its own; the agent's replies are marked by a thin line on the left.
 */
export function AgentMessage({
  author,
  when,
  text,
  quote,
}: {
  author: string;
  when: string;
  text: string;
  quote?: string | null;
}) {
  const mine = author === "user";
  return (
    <div className={`pl-2 ${mine ? "border-l-2 border-transparent" : "border-l-2 border-violet-400 dark:border-violet-700"}`}>
      <div className="flex items-baseline gap-1.5 text-[11px] text-muted-foreground">
        <span className={`font-medium ${mine ? "text-foreground" : "text-violet-700 dark:text-violet-300"}`}>
          {mine ? "You" : `@${author}`}
        </span>
        <span>{formatRelativeDate(when)}</span>
      </div>
      {quote ? <p className="truncate text-[11px] text-muted-foreground" title={quote}>“{quote}”</p> : null}
      <NoteMarkdown text={text} className="text-xs text-foreground" />
    </div>
  );
}

/** A small dot instead of a badge; red when the agent waits for the user. */
function Status({ note }: { note: AgentNote }) {
  const [dot, label] = noteNeedsYou(note)
    ? ["bg-red-500", "Needs you"]
    : note.status === "draft"
      ? ["border border-dashed border-gray-500", "Draft"]
      : note.status === "done"
        ? ["bg-gray-400", "Done"]
        : ["bg-amber-400", "Open"];
  return (
    <span className="flex shrink-0 items-center" title={label}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function lastActivity(note: AgentNote): string {
  return note.replies[note.replies.length - 1]?.createdAt ?? note.createdAt;
}

/**
 * A conversation (one note and its replies) that folds to a single line:
 * status dot and first line (bold while it waits for the user). The header is
 * the keyboard target; the list moves focus between headers. Rows are flat,
 * divided by a line; the selected one is shaded and shows its actions.
 */
export const AgentConversation = forwardRef<
  HTMLButtonElement,
  {
    note: AgentNote;
    expanded: boolean;
    selected: boolean;
    replying: boolean;
    onToggle: () => void;
    onFocus: () => void;
    /** Shown on the selected, expanded conversation; keys in the panel mirror them. */
    actions?: { label: string; keys: string; run: () => void }[];
  }
>(function AgentConversation({ note, expanded, selected, replying, onToggle, onFocus, actions = [] }, ref) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const firstLine = note.body.split("\n")[0];
  const kind = note.kind ? (KIND_LABELS[note.kind] ?? note.kind) : null;
  const about = [kind, note.context ? `About ${note.context}` : null].filter(Boolean).join(" · ");
  const done = note.status === "done";
  return (
    <div
      className={`border-b border-border/60 ${selected ? "bg-accent/40" : ""} ${replying ? "shadow-[inset_2px_0_0] shadow-primary" : ""}`}
      data-agent-conversation={note.id}
    >
      <button
        ref={ref}
        type="button"
        aria-expanded={expanded}
        tabIndex={selected ? 0 : -1}
        onClick={onToggle}
        onFocus={onFocus}
        className={`flex w-full min-w-0 items-center gap-1.5 px-1 py-1 text-left text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring ${done ? "text-muted-foreground" : ""}`}
      >
        <Chevron className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Status note={note} />
        <span className={`min-w-0 flex-1 truncate ${noteNeedsYou(note) ? "font-semibold" : ""}`}>{firstLine}</span>
      </button>
      {expanded ? (
        <div className="space-y-1.5 pb-2 pl-5 pr-1">
          {about ? (
            <p className="truncate text-[11px] text-muted-foreground" title={about}>
              {about}
            </p>
          ) : null}
          <AgentMessage author="user" when={note.createdAt} text={note.body} quote={note.quote} />
          {note.replies.map((reply, index) => (
            <AgentMessage key={`${note.id}-${index}`} author={reply.author} when={reply.createdAt} text={reply.body} />
          ))}
          {done && note.resolved ? <p className="text-[11px] text-muted-foreground">✓ {note.resolved}</p> : null}
          {selected && actions.length ? (
            <div className="flex flex-wrap gap-x-3 text-[11px]">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  tabIndex={-1}
                  onClick={action.run}
                  title={`${action.label} (${action.keys})`}
                  className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export { lastActivity };
