import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from "react";
import { ChevronsDownUp, ChevronsUpDown, ChevronDown, ChevronRight } from "lucide-react";
import type { AgentNote, AgentNoteItem, AgentNoteKind } from "@/lib/azdoCommands";
import { focusPrimaryGrid } from "@/lib/utils";
import { NoteCard } from "./NoteCard";
import { NoteComposer } from "./NoteComposer";
import { NoteThread } from "./NoteThread";
import { isNoteUnread, markNoteSeen } from "./noteSeen";
import type { AgentNoteActions } from "./useAgentNoteActions";
import type { NoteAnchor } from "./types";

// Lists the agent notes for one work item or PR and hosts the composer. Notes
// waiting for the user come first, then open notes in result order, then
// drafts; done notes are folded under a header. Pinned notes are numbered to
// match the gutter pins in the result.

const DONE_ROW = "__done__";
const COLLAPSE_KEY = "agentNotes.collapseAll";

type Props = {
  item: AgentNoteItem;
  /** Notes subfolder name, e.g. `wi-123` or `pr-45`. */
  folderName: string;
  anchors: NoteAnchor[];
  done: AgentNote[];
  hasResult: boolean;
  resultHash: string | null;
  activeId: string | null;
  pendingQuote: string | null;
  reattachId: string | null;
  /** Done notes whose change the agent marked in the result. */
  changeIds: ReadonlySet<string>;
  actions: AgentNoteActions;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  onReveal: (id: string) => void;
  onShowChange: (id: string) => void;
  onReattach: (id: string | null) => void;
  onSend: (body: string, kind: AgentNoteKind, draft: boolean) => Promise<boolean>;
  onClearQuote: () => void;
  onCancel: () => void;
  /** Extra controls at the right of the header (run agent, open the result file). */
  headerActions?: ReactNode;
};

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function loadCollapseAll(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export function AgentNotesPane(props: Props) {
  const { item, anchors, done, activeId, actions, composerRef, listRef } = props;
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [collapseAll, setCollapseAll] = useState(loadCollapseAll);
  const [cardOverride, setCardOverride] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [threadOpen, setThreadOpen] = useState<ReadonlySet<string>>(new Set());
  const [showDone, setShowDone] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyRequest, setReplyRequest] = useState({ id: "", n: 0 });

  const needs = anchors.filter((a) => a.tone === "needs");
  const open = anchors.filter((a) => a.tone === "open");
  const drafts = anchors.filter((a) => a.tone === "draft");
  const ordered = [...needs, ...open, ...drafts];
  const ids = [
    ...ordered.map((a) => a.note.id),
    ...(done.length ? [DONE_ROW] : []),
    ...(showDone ? done.map((n) => n.id) : []),
  ];
  const tabStopId = focusedId && ids.includes(focusedId) ? focusedId : ids[0];
  const allNotes = [...ordered.map((a) => a.note), ...done];
  const noteById = (id: string) => allNotes.find((n) => n.id === id);

  const isCollapsed = (id: string) => cardOverride.get(id) ?? collapseAll;
  const setCollapsed = (id: string, value: boolean) =>
    setCardOverride((prev) => new Map(prev).set(id, value));
  const setThread = (id: string, value: boolean) => {
    setThreadOpen((prev) => {
      const next = new Set(prev);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
    const note = noteById(id);
    if (value && note) markNoteSeen(item, note);
  };

  function toggleCollapseAll() {
    const next = !collapseAll;
    setCollapseAll(next);
    setCardOverride(new Map());
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      // Only a remembered preference.
    }
  }

  function focusItem(id: string | undefined) {
    if (!id) return;
    listRef.current?.querySelector<HTMLElement>(`[data-agent-note-id="${CSS.escape(id)}"]`)?.focus();
  }

  function reveal(id: string) {
    props.onReveal(id);
    const note = noteById(id);
    if (note) markNoteSeen(item, note);
  }

  // A note moving between groups (a reply reopens it, the agent finishes it
  // while we poll) remounts its row, which drops focus to <body>. Put it back
  // on the same note so keyboard navigation is not stranded.
  const listHasFocusRef = useRef(false);
  useEffect(() => {
    const active = document.activeElement;
    if (listHasFocusRef.current && focusedId && (!active || active === document.body)) {
      focusItem(focusedId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on list changes
  }, [anchors, done, showDone]);

  function toggleStatus(note: AgentNote) {
    actions.setStatus.mutate({ noteId: note.id, status: note.status === "done" ? "open" : "done" });
  }

  function remove(note: AgentNote, index: number) {
    if (note.status === "done") return;
    focusItem(ids[index + 1] ?? ids[index - 1]);
    actions.remove.mutate(note);
  }

  function handleListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const id = (event.target as HTMLElement).dataset.agentNoteId;
    if (!id || event.ctrlKey || event.metaKey || event.altKey) return;
    const index = ids.indexOf(id);
    const note = noteById(id);
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === "ArrowDown" || key === "ArrowUp") {
      handled();
      focusItem(ids[index + (key === "ArrowDown" ? 1 : -1)]);
    } else if (key === "Escape") {
      handled();
      focusPrimaryGrid();
    } else if (key === "c") {
      handled();
      composerRef.current?.focus();
    } else if (id === DONE_ROW) {
      if (key === "Enter" || key === "ArrowRight" || key === "ArrowLeft") {
        handled();
        setShowDone(key === "Enter" ? !showDone : key === "ArrowRight");
      }
    } else if (!note) {
      return;
    } else if (key === "ArrowRight") {
      handled();
      if (isCollapsed(id)) setCollapsed(id, false);
      else setThread(id, true);
    } else if (key === "ArrowLeft") {
      handled();
      if (threadOpen.has(id)) setThread(id, false);
      else setCollapsed(id, true);
    } else if (key === "Enter") {
      handled();
      if (note.status === "done" && props.changeIds.has(id)) props.onShowChange(id);
      else reveal(id);
    } else if (key === "r") {
      handled();
      setCollapsed(id, false);
      setThread(id, true);
      setReplyRequest((prev) => ({ id, n: prev.n + 1 }));
    } else if (key === "x" && note.status !== "draft") {
      handled();
      toggleStatus(note);
    } else if (key === "e" && note.status !== "done" && !note.replies.length) {
      handled();
      setCollapsed(id, false);
      setEditingId(id);
    } else if (key === "l" && note.status !== "done") {
      handled();
      props.onReattach(props.reattachId === id ? null : id);
    } else if (key === "Delete") {
      handled();
      remove(note, index);
    }
  }

  function card(note: AgentNote, extra: Pick<NoteAnchor, "num" | "range"> & { tone: NoteAnchor["tone"] | "done" }, index: number) {
    const expandedThread = threadOpen.has(note.id);
    return (
      <NoteCard
        key={note.id}
        note={note}
        tone={extra.tone}
        num={extra.num}
        active={note.id === activeId}
        tabStop={note.id === tabStopId}
        collapsed={isCollapsed(note.id)}
        unread={isNoteUnread(item, note)}
        orphan={props.hasResult && !!note.quote && !extra.range && note.status !== "done"}
        resultChanged={!!note.resultHash && !!props.resultHash && note.resultHash !== props.resultHash}
        hasChange={props.changeIds.has(note.id)}
        reattaching={props.reattachId === note.id}
        editing={editingId === note.id}
        formatTime={formatTime}
        onReveal={() => reveal(note.id)}
        onToggle={() => setCollapsed(note.id, !isCollapsed(note.id))}
        onToggleStatus={() => toggleStatus(note)}
        onEdit={() => setEditingId(note.id)}
        onSaveEdit={async (body) => {
          try {
            await actions.update.mutateAsync({ ...item, noteId: note.id, body });
          } catch {
            return false;
          }
          setEditingId(null);
          focusItem(note.id);
          return true;
        }}
        onCancelEdit={() => {
          setEditingId(null);
          focusItem(note.id);
        }}
        onDelete={() => remove(note, index)}
        onReattach={() => props.onReattach(props.reattachId === note.id ? null : note.id)}
        onShowChange={() => props.onShowChange(note.id)}
        thread={
          <NoteThread
            note={note}
            expanded={expandedThread}
            focusRequest={replyRequest.id === note.id ? replyRequest.n : 0}
            sending={actions.reply.isPending}
            formatTime={formatTime}
            onToggle={() => setThread(note.id, !expandedThread)}
            onReply={(body) =>
              actions.reply.mutateAsync({ noteId: note.id, body }).then(() => true, () => false)
            }
            onLeave={() => focusItem(note.id)}
          />
        }
      />
    );
  }

  const DoneChevron = showDone ? ChevronDown : ChevronRight;
  const CollapseIcon = collapseAll ? ChevronsUpDown : ChevronsDownUp;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col text-xs">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1">
        <span className="font-medium" title={`Saved as Markdown files in .to-agent-msg/${props.folderName}/`}>
          Agent notes
        </span>
        {needs.length ? (
          <span className="rounded-full bg-red-500 px-1.5 text-[10px] text-white">{needs.length} needs you</span>
        ) : null}
        {open.length ? (
          <span className="rounded-full bg-yellow-200 px-1.5 text-[10px] text-yellow-900">{open.length} open</span>
        ) : null}
        <span className="ml-auto" />
        <button
          type="button"
          onClick={toggleCollapseAll}
          title={collapseAll ? "Expand all notes" : "Collapse all notes to one line"}
          aria-label={collapseAll ? "Expand all notes" : "Collapse all notes"}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <CollapseIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        {props.headerActions}
      </div>
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-auto"
        onKeyDown={handleListKeyDown}
        onFocus={(e) => {
          listHasFocusRef.current = true;
          setFocusedId((e.target as HTMLElement).dataset.agentNoteId ?? null);
        }}
        onBlur={(e) => {
          // A row unmounting also blurs; only a real move elsewhere clears it.
          if (e.target.isConnected && !listRef.current?.contains(e.relatedTarget as Node | null)) {
            listHasFocusRef.current = false;
          }
        }}
      >
        {ids.length === 0 ? (
          <p className="px-2 py-2 text-muted-foreground">
            No notes yet. Select text in the result or press R on the grid, then C to comment.
          </p>
        ) : null}
        {ordered.map((a, index) => card(a.note, a, index))}
        {done.length ? (
          <button
            type="button"
            data-agent-note-id={DONE_ROW}
            tabIndex={tabStopId === DONE_ROW ? 0 : -1}
            aria-expanded={showDone}
            onClick={() => setShowDone(!showDone)}
            className="flex w-full items-center gap-1 px-2 pb-0.5 pt-2 text-left text-[11px] font-medium text-muted-foreground outline-none focus:bg-secondary"
          >
            <DoneChevron className="h-3 w-3" aria-hidden="true" />
            Done ({done.length})
          </button>
        ) : null}
        {showDone
          ? done.map((note, i) => card(note, { tone: "done", num: null, range: null }, ordered.length + 1 + i))
          : null}
      </div>
      {actions.deleted ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-border bg-secondary px-2 py-1 text-[11px]">
          <span>Note deleted.</span>
          <button
            type="button"
            onClick={actions.undoDelete}
            className="font-medium text-primary underline focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Undo (Ctrl+Z)
          </button>
        </div>
      ) : null}
      {props.reattachId ? (
        <p className="shrink-0 border-t border-border bg-amber-50 px-2 py-1 text-[11px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Select text in the result (or press C on a block) to re-attach the note. Esc cancels.
        </p>
      ) : null}
      <NoteComposer
        composerRef={composerRef}
        pendingQuote={props.pendingQuote}
        draftCount={drafts.length}
        sending={actions.create.isPending}
        error={actions.error}
        onSend={props.onSend}
        onSendDrafts={() => actions.submitDrafts.mutate()}
        onClearQuote={props.onClearQuote}
        onCancel={props.onCancel}
      />
    </div>
  );
}
