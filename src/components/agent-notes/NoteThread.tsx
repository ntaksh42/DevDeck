import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AgentNote } from "@/lib/azdoCommands";

// The reply thread under one agent note: collapsed to a count by default,
// expanded it lists the agent/user replies and a reply box. Replying to a done
// note reopens it (the backend moves it back out of `_done/`).

/** Replies by the user are "You"; any other author is an agent, shown by the
 *  name it wrote in the marker (`claude` -> `@Claude`, legacy `agent` -> `@Agent`). */
export function replyAuthorLabel(author: string): { label: string; isAgent: boolean } {
  if (author === "user") return { label: "You", isAgent: false };
  return { label: `@${author.charAt(0).toUpperCase()}${author.slice(1)}`, isAgent: true };
}

type Props = {
  note: AgentNote;
  expanded: boolean;
  /** Bumped to focus the reply box (R on the note). */
  focusRequest: number;
  sending: boolean;
  formatTime: (value: string) => string;
  onToggle: () => void;
  onReply: (body: string) => Promise<boolean>;
  /** Returns focus to the note row. */
  onLeave: () => void;
};

export function NoteThread({
  note, expanded, focusRequest, sending, formatTime, onToggle, onReply, onLeave,
}: Props) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const count = note.replies.length;
  const last = count > 0 ? replyAuthorLabel(note.replies[count - 1].author) : null;

  useEffect(() => {
    if (focusRequest && expanded) inputRef.current?.focus();
  }, [focusRequest, expanded]);

  async function send() {
    if (!draft.trim() || sending) return;
    if (await onReply(draft)) {
      setDraft("");
      onLeave();
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      void send();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onLeave();
    }
  }

  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div className="mt-1">
      <button
        type="button"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-expanded={expanded}
        title={expanded ? "Collapse thread (←)" : "Expand thread (→) · Reply (R)"}
        className="inline-flex items-center gap-0.5 rounded px-0.5 text-[11px] text-muted-foreground hover:bg-background hover:text-foreground"
      >
        <Chevron className="h-3 w-3" aria-hidden="true" />
        {count ? `${count} ${count === 1 ? "reply" : "replies"}` : "Reply"}
        {last?.isAgent && !expanded ? (
          <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-800 dark:bg-sky-950 dark:text-sky-300">
            {last.label}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <div className="ml-1.5 mt-1 flex flex-col gap-1 border-l-2 border-border pl-2" onClick={(e) => e.stopPropagation()}>
          {note.replies.map((reply, index) => {
            const { label, isAgent } = replyAuthorLabel(reply.author);
            return (
              <div key={index}>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={`font-medium ${isAgent ? "text-sky-700 dark:text-sky-400" : "text-foreground"}`}>
                    {label}
                  </span>
                  {reply.createdAt ? <span>{formatTime(reply.createdAt)}</span> : null}
                </div>
                <p className="whitespace-pre-wrap break-words">{reply.body}</p>
              </div>
            );
          })}
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            aria-label={`Reply to note ${note.id}`}
            placeholder={note.status === "done" ? "Reply (reopens the note)…" : "Reply…"}
            className="w-full resize-y rounded border border-border bg-background px-1.5 py-1 outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex items-center gap-1.5">
            <span className="mr-auto text-[11px] text-muted-foreground">Ctrl+Enter send · Esc back</span>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => void send()}
              disabled={!draft.trim() || sending}
              className="rounded bg-primary px-2 py-0.5 font-medium text-primary-foreground disabled:opacity-50"
            >
              {sending ? "Sending…" : "Reply"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
