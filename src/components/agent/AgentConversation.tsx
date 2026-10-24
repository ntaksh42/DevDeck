import { forwardRef } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { noteNeedsYou, type AgentNote } from "@/lib/azdoCommands";
import { NoteMarkdown } from "@/components/agent-notes/NoteMarkdown";
import { CommentComposer } from "@/features/pull-requests/CommentComposer";
import { CommentAvatar } from "@/features/pull-requests/PrThreadCard";
import { formatRelativeDate } from "@/lib/utils";
import { AgentProposal } from "./AgentProposal";

const KIND_LABELS: Record<string, string> = {
  investigate: "Investigate",
  summarize: "Summarize",
  question: "Question",
  fix: "Fix",
  redo: "Redo",
};

/**
 * One message of a conversation: the user's request or a reply, laid out like
 * a PR comment (avatar, author, time, then the body indented under them). The
 * agent's name stays violet so its replies are told apart at a glance.
 */
export function AgentMessage({
  author,
  when,
  text,
  quote,
  hideMeta = false,
}: {
  author: string;
  when: string;
  text: string;
  quote?: string | null;
  /** The author and time are shown elsewhere (the expanded header). */
  hideMeta?: boolean;
}) {
  const mine = author === "user";
  const name = mine ? "You" : `@${author}`;
  return (
    <div className="text-xs">
      {hideMeta ? null : (
        <div className="flex min-w-0 items-center gap-1.5">
          <CommentAvatar name={mine ? "You" : author} />
          <span className={`truncate font-medium ${mine ? "text-foreground" : "text-violet-700 dark:text-violet-300"}`}>{name}</span>
          <span className="shrink-0 text-2xs text-muted-foreground">{formatRelativeDate(when)}</span>
        </div>
      )}
      <div className="pl-[26px]">
        {quote ? (
          <p className="line-clamp-2 break-words border-l-2 border-border pl-1.5 text-2xs text-muted-foreground" title={quote}>
            {quote}
          </p>
        ) : null}
        <NoteMarkdown text={text} className="text-[13px] leading-5 text-foreground" />
      </div>
    </div>
  );
}

/** The conversation's state as a pill, where a PR thread shows Active / Resolved. */
function Status({ note }: { note: AgentNote }) {
  const [tone, label] = noteNeedsYou(note)
    ? ["border-destructive/30 bg-destructive/10 text-destructive", "Needs you"]
    : note.status === "draft"
      ? ["border-dashed border-border text-muted-foreground", "Draft"]
      : note.status === "done"
        ? ["border-border bg-muted text-muted-foreground", "Done"]
        : ["border-warning/30 bg-warning/10 text-warning", "Open"];
  return <span className={`shrink-0 rounded border px-1.5 text-2xs leading-4 ${tone}`}>{label}</span>;
}

function lastActivity(note: AgentNote): string {
  return note.replies[note.replies.length - 1]?.createdAt ?? note.createdAt;
}

/**
 * A conversation (one note and its replies), styled like a PR comment thread:
 * open ones carry the amber left bar of an unresolved thread, done ones are
 * greyed. Folded, it is one line: avatar, first line (bold while it waits for
 * the user), reply count and state. The header is the keyboard target; the
 * list moves focus between headers. The selected one gets an accent ring and
 * shows its actions.
 */
export const AgentConversation = forwardRef<
  HTMLButtonElement,
  {
    note: AgentNote;
    expanded: boolean;
    selected: boolean;
    onToggle: () => void;
    onFocus: () => void;
    /** Shown on the selected, expanded conversation; keys in the panel mirror them. */
    actions?: { label: string; keys: string; run: () => void }[];
    /** Sends a reply in this conversation; the box under it folds to one line while empty. */
    onReply: (body: string) => Promise<void>;
    replyBusy: boolean;
    /** The reply box's wrapper, so the panel can focus it (R). */
    replyRef: (el: HTMLDivElement | null) => void;
    /** Esc in an empty reply box: back to this conversation's header. */
    onReplyCollapse: () => void;
    /** Posts the proposed comment at this reply index; null where nothing can be posted. */
    onPostProposal?: ((replyIndex: number) => void) | null;
    postBusy?: boolean;
    postError?: string | null;
    autoPost?: boolean;
  }
>(function AgentConversation(
  {
    note,
    expanded,
    selected,
    onToggle,
    onFocus,
    actions = [],
    onReply,
    replyBusy,
    replyRef,
    onReplyCollapse,
    onPostProposal = null,
    postBusy = false,
    postError = null,
    autoPost = false,
  },
  ref,
) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const firstLine = note.body.split("\n")[0];
  const kind = note.kind ? (KIND_LABELS[note.kind] ?? note.kind) : null;
  // Expanded, the header carries who/when/what about instead of repeating the
  // first line, which the message right below shows in full.
  const meta = ["You", formatRelativeDate(note.createdAt), kind, note.context ? `About ${note.context}` : null]
    .filter(Boolean)
    .join(" · ");
  const done = note.status === "done";
  return (
    <div
      className={`overflow-hidden rounded-md border ${
        done ? "border-border bg-muted/60" : "border-border border-l-[3px] border-l-warning bg-card"
      } ${selected ? "ring-1 ring-primary/60" : ""}`}
      data-agent-conversation={note.id}
    >
      <button
        ref={ref}
        type="button"
        aria-expanded={expanded}
        tabIndex={selected ? 0 : -1}
        onClick={onToggle}
        onFocus={onFocus}
        className={`flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-left text-xs outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${done ? "text-muted-foreground" : ""}`}
      >
        <Chevron className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        <CommentAvatar name="You" />
        {expanded ? (
          <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground" title={meta}>
            <span className="font-medium text-foreground">You</span>
            {meta.slice("You".length)}
          </span>
        ) : (
          <>
            <span className={`min-w-0 flex-1 truncate ${noteNeedsYou(note) ? "font-semibold text-foreground" : ""}`} title={note.body}>
              {firstLine}
            </span>
            {note.replies.length ? (
              <span className="shrink-0 text-2xs text-muted-foreground" title={`${note.replies.length} replies`}>
                {note.replies.length}
              </span>
            ) : null}
          </>
        )}
        <Status note={note} />
      </button>
      {expanded ? (
        <div className="space-y-1.5 px-2 pb-2">
          <AgentMessage author="user" when={note.createdAt} text={note.body} quote={note.quote} hideMeta />
          {note.replies.map((reply, index) =>
            reply.kind === "post" ? (
              <AgentProposal
                key={`${note.id}-${index}`}
                reply={reply}
                onPost={onPostProposal ? () => onPostProposal(index) : null}
                busy={postBusy}
                autoPost={autoPost}
                error={postError}
              />
            ) : (
              <AgentMessage key={`${note.id}-${index}`} author={reply.author} when={reply.createdAt} text={reply.body} />
            ),
          )}
          {done && note.resolved ? <p className="pl-[26px] text-2xs text-muted-foreground">✓ {note.resolved}</p> : null}
          {selected && actions.length ? (
            <div className="flex flex-wrap gap-x-3 pl-[26px] text-2xs">
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
          <div ref={replyRef} data-agent-reply={note.id} className="pl-[26px]">
            <CommentComposer
              placeholder="Reply… (R)"
              submitLabel="Reply"
              busy={replyBusy}
              collapsible
              onCollapse={onReplyCollapse}
              onSubmit={onReply}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
});

export { lastActivity };
