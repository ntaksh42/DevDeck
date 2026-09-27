import { useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import type { AgentNoteKind } from "@/lib/azdoCommands";
import { CommentField, commentSecondaryButtonClass } from "@/components/CommentField";

// The new-note box under the list. It stays one line until focused (C), so the
// list keeps the height. Ctrl+Enter sends now, Alt+Enter adds to the drafts,
// and Ctrl+Shift+Enter sends all drafts together.

type Props = {
  composerRef: RefObject<HTMLTextAreaElement | null>;
  pendingQuote: string | null;
  draftCount: number;
  sending: boolean;
  error: string | null;
  onSend: (body: string, kind: AgentNoteKind, draft: boolean) => Promise<boolean>;
  onSendDrafts: () => void;
  onClearQuote: () => void;
  onCancel: () => void;
};

const KINDS: { value: AgentNoteKind; label: string }[] = [
  { value: "fix", label: "Fix" },
  { value: "question", label: "Question" },
  { value: "redo", label: "Redo" },
];

export function NoteComposer({
  composerRef, pendingQuote, draftCount, sending, error, onSend, onSendDrafts, onClearQuote, onCancel,
}: Props) {
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<AgentNoteKind>("fix");
  const [focused, setFocused] = useState(false);
  const expanded = focused || !!draft || !!pendingQuote;

  async function send(asDraft: boolean) {
    if (!draft.trim() || sending) return;
    if (await onSend(draft, kind, asDraft)) {
      setDraft("");
      setKind("fix");
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const stop = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && event.shiftKey) {
      stop();
      if (draftCount) onSendDrafts();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      stop();
      void send(false);
    } else if (event.key === "Enter" && event.altKey) {
      stop();
      void send(true);
    } else if (event.key === "Escape") {
      stop();
      onCancel();
    }
  }

  return (
    <div className="flex shrink-0 flex-col gap-1 border-t border-border p-2">
      {draftCount ? (
        <div className="flex items-center gap-2 rounded border border-dashed border-border px-2 py-0.5 text-[11px]">
          <span className="text-muted-foreground">
            {draftCount} draft{draftCount === 1 ? "" : "s"} not sent yet
          </span>
          <button
            type="button"
            onClick={onSendDrafts}
            className="ml-auto rounded px-1 font-medium text-primary hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
            title="Send every draft to the agent (Ctrl+Shift+Enter)"
          >
            Send all
          </button>
        </div>
      ) : null}
      {pendingQuote ? (
        <blockquote className="line-clamp-3 border-l-2 border-orange-500 pl-1.5 text-muted-foreground">{pendingQuote}</blockquote>
      ) : null}
      <div onFocus={() => setFocused(true)} onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}>
        <CommentField
          textareaRef={composerRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={expanded ? 3 : 1}
          showActions={expanded}
          aria-label="Note to the agent"
          placeholder={pendingQuote ? "Comment on the quoted text…" : expanded ? "Note to the agent…" : "+ Add a note for the agent… (C)"}
          error={error}
          hint="Ctrl+Enter send · Alt+Enter add to drafts · Esc cancel"
          extraActions={
            <>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as AgentNoteKind)}
                aria-label="Kind of note"
                title="Fix: change the result · Question: just answer · Redo: redo the work"
                className="h-6 rounded border border-input bg-background px-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
              {pendingQuote ? (
                <button type="button" onClick={onClearQuote} className={commentSecondaryButtonClass}>
                  Remove quote
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void send(true)}
                disabled={!draft.trim() || sending}
                className={commentSecondaryButtonClass}
                title="Save without sending (Alt+Enter)"
              >
                Add to drafts
              </button>
            </>
          }
          submitLabel="Send"
          submitDisabled={!draft.trim()}
          pending={sending}
          onSubmit={() => void send(false)}
        />
      </div>
    </div>
  );
}
