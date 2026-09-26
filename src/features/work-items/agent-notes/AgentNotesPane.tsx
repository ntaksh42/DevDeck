import { useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { Trash2 } from "lucide-react";
import type { AgentNote } from "@/lib/azdoCommands";
import { focusPrimaryGrid } from "@/lib/utils";
import type { NoteAnchor } from "./types";

// Lists the agent notes for one work item and hosts the composer. Open notes
// are numbered to match the gutter pins in the result; notes whose quote no
// longer appears in the regenerated result are flagged instead of dropped.

type Props = {
  workItemId: number;
  open: NoteAnchor[];
  done: AgentNote[];
  hasResult: boolean;
  activeId: string | null;
  pendingQuote: string | null;
  sending: boolean;
  error: string | null;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  onReveal: (id: string) => void;
  onDelete: (id: string) => void;
  onClearQuote: () => void;
  onSend: (body: string) => Promise<boolean>;
  onCancel: () => void;
};

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function AgentNotesPane({
  workItemId, open, done, hasResult, activeId, pendingQuote, sending, error,
  composerRef, listRef, onReveal, onDelete, onClearQuote, onSend, onCancel,
}: Props) {
  const [draft, setDraft] = useState("");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const ids = [...open.map((a) => a.note.id), ...done.map((n) => n.id)];
  const tabStopId = focusedId && ids.includes(focusedId) ? focusedId : ids[0];

  function focusItem(id: string | undefined) {
    if (!id) return;
    listRef.current?.querySelector<HTMLElement>(`[data-agent-note-id="${CSS.escape(id)}"]`)?.focus();
  }

  function handleListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const id = (event.target as HTMLElement).dataset.agentNoteId;
    if (!id || event.ctrlKey || event.metaKey || event.altKey) return;
    const index = ids.indexOf(id);
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      handled();
      const next = ids[index + (event.key === "ArrowDown" ? 1 : -1)];
      focusItem(next);
    } else if (event.key === "Enter") {
      handled();
      onReveal(id);
    } else if (event.key === "Delete" && open.some((a) => a.note.id === id)) {
      handled();
      focusItem(ids[index + 1] ?? ids[index - 1]);
      onDelete(id);
    } else if (event.key === "Escape") {
      handled();
      focusPrimaryGrid();
    }
  }

  async function send() {
    if (!draft.trim() || sending) return;
    if (await onSend(draft)) setDraft("");
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      void send();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  }

  const itemClass = (id: string) =>
    `border-b border-border px-2 py-1.5 outline-none focus:bg-secondary focus:shadow-[inset_2px_0_0_hsl(var(--primary))] ${
      id === activeId ? "bg-secondary" : ""
    }`;

  return (
    <div className="flex min-h-0 flex-1 flex-col text-xs">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1">
        <span className="font-medium">Agent notes</span>
        {open.length ? (
          <span className="rounded-full bg-yellow-200 px-1.5 text-[10px] text-yellow-900">{open.length} open</span>
        ) : null}
        <span className="ml-auto truncate text-muted-foreground" title="Notes are saved as Markdown files for the investigating agent">
          .to-agent-msg/wi-{workItemId}/
        </span>
      </div>
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-auto"
        onKeyDown={handleListKeyDown}
        onFocus={(e) => setFocusedId((e.target as HTMLElement).dataset.agentNoteId ?? null)}
      >
        {open.length === 0 && done.length === 0 ? (
          <p className="px-2 py-2 text-muted-foreground">
            No notes yet. Select text in the result or press R on the grid, then C to comment.
          </p>
        ) : null}
        {open.map(({ note, num, range }) => {
          const orphan = hasResult && !!note.quote && !range;
          return (
            <div
              key={note.id}
              data-agent-note-id={note.id}
              tabIndex={note.id === tabStopId ? 0 : -1}
              onMouseEnter={() => onReveal(note.id)}
              onClick={() => onReveal(note.id)}
              title={note.filePath}
              className={itemClass(note.id)}
            >
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {num != null ? (
                  <span className={`inline-block h-4 min-w-4 rounded-full text-center text-[10px] font-bold leading-4 ${
                    note.id === activeId ? "bg-orange-500 text-white" : "bg-yellow-400 text-gray-900"
                  }`}>{num}</span>
                ) : null}
                <span>{formatTime(note.createdAt)}</span>
                {orphan ? (
                  <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800">Not found in current result</span>
                ) : !note.quote ? (
                  <span className="rounded bg-muted px-1 text-[10px]">General</span>
                ) : null}
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(note.id);
                  }}
                  title="Delete note (Del)"
                  aria-label="Delete note"
                  className="ml-auto rounded p-0.5 hover:bg-background"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
              {note.quote ? (
                <blockquote className={`my-1 line-clamp-3 border-l-2 pl-1.5 text-muted-foreground ${
                  orphan ? "border-amber-500 line-through" : "border-yellow-400"
                }`}>{note.quote}</blockquote>
              ) : null}
              <p className="whitespace-pre-wrap break-words">{note.body}</p>
            </div>
          );
        })}
        {done.length ? (
          <p className="px-2 pb-0.5 pt-2 text-[11px] font-medium text-muted-foreground">Done</p>
        ) : null}
        {done.map((note) => (
          <div
            key={note.id}
            data-agent-note-id={note.id}
            tabIndex={note.id === tabStopId ? 0 : -1}
            title={note.filePath}
            className={`${itemClass(note.id)} opacity-80`}
          >
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>{formatTime(note.createdAt)}</span>
              <span className="rounded bg-emerald-100 px-1 text-[10px] text-emerald-800">Done</span>
            </div>
            {note.quote ? (
              <blockquote className="my-1 line-clamp-2 border-l-2 border-border pl-1.5 text-muted-foreground">{note.quote}</blockquote>
            ) : null}
            <p className="whitespace-pre-wrap break-words">{note.body}</p>
            {note.resolved ? (
              <p className="mt-1 whitespace-pre-wrap text-emerald-700 dark:text-emerald-400">{note.resolved}</p>
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex shrink-0 flex-col gap-1 border-t border-border p-2">
        {pendingQuote ? (
          <blockquote className="line-clamp-3 border-l-2 border-orange-500 pl-1.5 text-muted-foreground">{pendingQuote}</blockquote>
        ) : null}
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleComposerKeyDown}
          rows={3}
          aria-label="Note to the agent"
          placeholder={pendingQuote ? "Comment on the quoted text…" : "Note to the agent…"}
          className="w-full resize-y rounded border border-border bg-background px-1.5 py-1 outline-none focus:ring-2 focus:ring-ring"
        />
        {error ? <p className="text-destructive">{error}</p> : null}
        <div className="flex items-center gap-1.5">
          <span className="mr-auto text-[11px] text-muted-foreground">Ctrl+Enter send · Esc cancel</span>
          {pendingQuote ? (
            <button type="button" onClick={onClearQuote} className="rounded border border-border px-2 py-0.5 hover:bg-secondary">
              Remove quote
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void send()}
            disabled={!draft.trim() || sending}
            className="rounded bg-primary px-2 py-0.5 font-medium text-primary-foreground disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
