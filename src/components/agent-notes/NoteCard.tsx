import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Crosshair, Link2, Pencil, RotateCcw, Trash2 } from "lucide-react";
import type { AgentNote } from "@/lib/azdoCommands";
import { CommentField } from "@/components/CommentField";
import { NoteMarkdown } from "./NoteMarkdown";
import { replyAuthorLabel } from "./NoteThread";
import type { NoteTone } from "./types";

// One agent note in the list: a card that collapses to a single line. Shows
// the state chip, the quoted text, the body, and the agent's latest reply
// when it waits for the user.

export type CardTone = NoteTone | "done";

const CHIP: Record<CardTone, { label: string; className: string }> = {
  needs: { label: "Needs you", className: "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300" },
  open: { label: "Open", className: "border-border bg-muted text-muted-foreground" },
  draft: { label: "Draft", className: "border-dashed border-border text-muted-foreground" },
  done: { label: "Done", className: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300" },
};

export const PIN_CLASS: Record<NoteTone, string> = {
  needs: "bg-red-500 text-white",
  open: "bg-yellow-400 text-gray-900",
  draft: "border border-dashed border-gray-500 bg-white text-gray-700",
};

const KIND_LABEL: Record<string, string> = { question: "Question", redo: "Redo" };

type Props = {
  note: AgentNote;
  tone: CardTone;
  num: number | null;
  active: boolean;
  tabStop: boolean;
  collapsed: boolean;
  unread: boolean;
  /** The quote no longer appears in the current result. */
  orphan: boolean;
  /** The result HTML changed since the note was written. */
  resultChanged: boolean;
  /** The agent marked what it changed for this note in the result. */
  hasChange: boolean;
  reattaching: boolean;
  editing: boolean;
  thread: ReactNode;
  formatTime: (value: string) => string;
  onReveal: () => void;
  onToggle: () => void;
  onToggleStatus: () => void;
  onEdit: () => void;
  onSaveEdit: (body: string) => Promise<boolean>;
  onCancelEdit: () => void;
  onDelete: () => void;
  onReattach: () => void;
  onShowChange: () => void;
};

const iconButton =
  "rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground";

export function NoteCard(props: Props) {
  const { note, tone, num, active, tabStop, collapsed, unread, orphan, editing } = props;
  const chip = CHIP[tone];
  const lastReply = note.replies[note.replies.length - 1];
  const editable = tone !== "done" && note.replies.length === 0;
  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <div
      data-agent-note-id={note.id}
      tabIndex={tabStop ? 0 : -1}
      onMouseEnter={props.onReveal}
      onClick={props.onReveal}
      title={note.filePath}
      className={`group border-b border-border px-2 py-1.5 outline-none focus:bg-secondary focus:shadow-[inset_2px_0_0_hsl(var(--primary))] ${
        active ? "bg-secondary" : ""
      } ${tone === "done" ? "opacity-80" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <button
          type="button"
          tabIndex={-1}
          aria-label={collapsed ? "Expand note" : "Collapse note"}
          title={collapsed ? "Expand (→)" : "Collapse (←)"}
          onClick={(e) => {
            e.stopPropagation();
            props.onToggle();
          }}
          className={iconButton}
        >
          <Chevron className="h-3 w-3" aria-hidden="true" />
        </button>
        {num != null && tone !== "done" ? (
          <span className={`inline-block h-4 min-w-4 shrink-0 rounded-full text-center text-[10px] font-bold leading-4 ${
            active ? "bg-orange-500 text-white" : PIN_CLASS[tone]
          }`}>{num}</span>
        ) : null}
        <span className={`shrink-0 rounded-full border px-1.5 text-[10px] leading-4 ${chip.className}`}>{chip.label}</span>
        {note.kind && KIND_LABEL[note.kind] ? (
          <span className="shrink-0 rounded border border-border px-1 text-[10px] leading-4">{KIND_LABEL[note.kind]}</span>
        ) : null}
        {unread ? (
          <span role="img" aria-label="New agent reply" title="New agent reply" className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />
        ) : null}
        {collapsed ? (
          <span className="min-w-0 flex-1 truncate text-foreground">{note.body.split("\n")[0]}</span>
        ) : (
          <span className="min-w-0 flex-1 truncate">{props.formatTime(note.createdAt)}</span>
        )}
        {collapsed && note.replies.length ? <span className="shrink-0">{note.replies.length}↩</span> : null}
        {!collapsed ? (
          <span className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus:opacity-100">
            {editable ? (
              <button type="button" tabIndex={-1} title="Edit (E)" aria-label="Edit note" className={iconButton}
                onClick={(e) => { e.stopPropagation(); props.onEdit(); }}>
                <Pencil className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : null}
            {tone !== "draft" ? (
              <button type="button" tabIndex={-1} className={iconButton}
                title={tone === "done" ? "Reopen (X)" : "Resolve (X)"}
                aria-label={tone === "done" ? "Reopen note" : "Resolve note"}
                onClick={(e) => { e.stopPropagation(); props.onToggleStatus(); }}>
                {tone === "done" ? <RotateCcw className="h-3 w-3" aria-hidden="true" /> : <Check className="h-3 w-3" aria-hidden="true" />}
              </button>
            ) : null}
            {tone !== "done" ? (
              <button type="button" tabIndex={-1} title="Delete (Del)" aria-label="Delete note" className={iconButton}
                onClick={(e) => { e.stopPropagation(); props.onDelete(); }}>
                <Trash2 className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {collapsed ? null : (
        <div className="pl-5">
          {note.quote ? (
            <blockquote className={`my-1 line-clamp-3 border-l-2 pl-1.5 text-muted-foreground ${
              orphan ? "border-amber-500" : tone === "done" ? "border-border" : "border-yellow-400"
            }`}>{note.quote}</blockquote>
          ) : (
            <p className="my-0.5 text-[10px] text-muted-foreground">General note</p>
          )}
          {orphan ? (
            <p className="flex items-center gap-1 text-[10px] text-amber-800 dark:text-amber-300">
              Not in the current result.
              <button type="button" tabIndex={-1} className="inline-flex items-center gap-0.5 underline"
                onClick={(e) => { e.stopPropagation(); props.onReattach(); }}>
                <Link2 className="h-3 w-3" aria-hidden="true" />
                {props.reattaching ? "Select text in the result…" : "Re-attach (L)"}
              </button>
            </p>
          ) : null}
          {props.resultChanged && tone !== "done" ? (
            <p className="text-[10px] text-muted-foreground">Result regenerated since this note</p>
          ) : null}
          {editing ? (
            <NoteEditor initial={note.body} onSave={props.onSaveEdit} onCancel={props.onCancelEdit} />
          ) : (
            <NoteMarkdown text={note.body} />
          )}
          {tone === "done" && note.resolved ? (
            <p className="mt-1 flex items-start gap-1 text-emerald-700 dark:text-emerald-400">
              <span className="min-w-0 flex-1 whitespace-pre-wrap">{note.resolved}</span>
              {props.hasChange ? (
                <button type="button" tabIndex={-1} className="inline-flex shrink-0 items-center gap-0.5 text-[10px] underline"
                  onClick={(e) => { e.stopPropagation(); props.onShowChange(); }}>
                  <Crosshair className="h-3 w-3" aria-hidden="true" />
                  Show change (Enter)
                </button>
              ) : null}
            </p>
          ) : null}
          {tone === "needs" && lastReply ? (
            <div className="mt-1 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 dark:border-red-900 dark:bg-red-950/40">
              <span className="font-medium text-red-700 dark:text-red-300">{replyAuthorLabel(lastReply.author).label}</span>
              <NoteMarkdown text={lastReply.body} className="line-clamp-3" />
            </div>
          ) : null}
          {props.thread}
        </div>
      )}
    </div>
  );
}

function NoteEditor({ initial, onSave, onCancel }: {
  initial: string;
  onSave: (body: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  async function save() {
    if (!value.trim() || pending) return;
    setPending(true);
    const ok = await onSave(value);
    setPending(false);
    if (!ok) ref.current?.focus();
  }
  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      void save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  }
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <CommentField
        textareaRef={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        aria-label="Edit note"
        hint="Ctrl+Enter to save · Esc to cancel"
        submitLabel="Save"
        submitDisabled={!value.trim()}
        pending={pending}
        onSubmit={() => void save()}
      />
    </div>
  );
}
