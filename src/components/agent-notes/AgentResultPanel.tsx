import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Bot, ExternalLink } from "lucide-react";
import {
  openAgentPanel,
  REATTACH_NOTE_EVENT,
  REVEAL_NOTE_EVENT,
  type NoteRequestDetail,
} from "@/components/agent/agentSubject";
import { commandErrorMessage, noteNeedsYou, type AgentNoteItem } from "@/lib/azdoCommands";
import { openLocalPath } from "@/lib/openExternal";
import { matchesCombo, resolveKeybindings } from "@/lib/keybindings";
import { focusPrimaryGrid, isEditableTarget } from "@/lib/utils";
import { LoadingState, PreviewEmptyState } from "@/components/StateDisplay";
import { ResultFrame } from "./ResultFrame";
import { lastAgentReplyAt, markItemSeen } from "./noteSeen";
import { buildTextIndex, hashResult, listBlocks, locateQuote } from "./resultAnchoring";
import { useAgentNoteActions } from "./useAgentNoteActions";
import type { CommentRequest, FrameState, NoteAnchor } from "./types";

type ResultPreview = { fileName: string; filePath: string; html: string; warning: string | null; tooLarge: boolean };

const headerButton =
  "shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

// A locally generated result HTML (work item investigation or PR review) with
// pins for the agent notes anchored to quoted text in it. The notes themselves
// are listed and written in the app-wide Agent panel: selecting text here (C)
// starts a note there, and a pin selects its note there. Callers own the
// result/settings queries.
export function AgentResultPanel({
  item,
  hasFolder,
  loading,
  error,
  preview,
  frameTitle,
  noFolderMessage,
  noMatchMessage,
  commentModeRequest = 0,
  primaryPreview = false,
}: {
  item: AgentNoteItem;
  hasFolder: boolean;
  loading: boolean;
  error: unknown;
  preview: ResultPreview | null;
  frameTitle: string;
  noFolderMessage: string;
  noMatchMessage: string;
  commentModeRequest?: number;
  /** Marks the panel as the focus target of Enter / Ctrl+P from the grid. */
  primaryPreview?: boolean;
}) {
  const { target, itemId } = item;
  const actions = useAgentNoteActions(item, hasFolder);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<FrameState | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [changeRange, setChangeRange] = useState<Range | null>(null);
  const [reattachId, setReattachId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const resultHash = useMemo(() => (preview && !preview.tooLarge ? hashResult(preview.html) : null), [preview]);

  useEffect(() => {
    setFrame(null);
    setActiveId(null);
    setChangeRange(null);
    setReattachId(null);
    setOpenError(null);
  }, [target, itemId, preview?.html]);

  // The body (and ResultFrame) unmounts while a row's preview loads, so the
  // effects below key off whether it is currently rendered.
  const showsBody = hasFolder && !loading && !error;

  // R on the grid asks for comment mode. Consume each request once, when the
  // result frame is ready (or there is no result), so later row changes that
  // remount the frame do not pull focus out of the grid.
  const handledCommentRequestRef = useRef(commentModeRequest);
  useEffect(() => {
    if (commentModeRequest === handledCommentRequestRef.current) return;
    if (frame) {
      handledCommentRequestRef.current = commentModeRequest;
      window.setTimeout(
        () => bodyRef.current?.querySelector<HTMLElement>("[data-agent-result-frame='true']")?.focus(),
        60,
      );
    } else if ((!hasFolder && !loading) || (showsBody && (!preview || preview.tooLarge))) {
      handledCommentRequestRef.current = commentModeRequest;
    }
  }, [commentModeRequest, frame, hasFolder, loading, showsBody, preview]);

  const notes = useMemo(() => actions.notesQuery.data ?? [], [actions.notesQuery.data]);
  const anchors: NoteAnchor[] = useMemo(() => {
    const located = notes
      .filter((n) => n.status !== "done")
      .map((note) => ({
        note,
        tone: note.status === "draft" ? ("draft" as const) : noteNeedsYou(note) ? ("needs" as const) : ("open" as const),
        range: frame
          ? locateQuote(frame.doc, frame.index, {
              quote: note.quote,
              prefix: note.quotePrefix,
              suffix: note.quoteSuffix,
              offset: note.quoteOffset,
            })
          : null,
      }));
    located.sort((a, b) =>
      a.range && b.range
        ? a.range.compareBoundaryPoints(Range.START_TO_START, b.range)
        : a.range ? -1 : b.range ? 1 : b.note.createdAt.localeCompare(a.note.createdAt),
    );
    return located.map((a, i) => ({ ...a, num: a.range ? i + 1 : null }));
  }, [notes, frame]);
  const done = useMemo(
    () => notes.filter((n) => n.status === "done").sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [notes],
  );
  // Done notes whose change the agent marked with `data-agent-note="{id}"`.
  const changeIds = useMemo(() => {
    const marked = new Set<string>();
    frame?.doc.querySelectorAll<HTMLElement>("[data-agent-note]").forEach((el) => {
      if (el.dataset.agentNote) marked.add(el.dataset.agentNote);
    });
    return new Set(done.filter((n) => marked.has(n.id)).map((n) => n.id));
  }, [frame, done]);

  // Opening the notes counts as having seen the agent's replies on the grid badge.
  useEffect(() => {
    const latest = notes.map(lastAgentReplyAt).filter((v): v is string => !!v).sort().pop() ?? null;
    markItemSeen({ target, itemId }, latest);
  }, [notes, target, itemId]);

  function handleFrameLoad() {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.body) return;
    setFrame({ doc, index: buildTextIndex(doc), blocks: listBlocks(doc) });
  }

  function reveal(id: string) {
    setActiveId(id);
    setChangeRange(null);
    const range = anchors.find((a) => a.note.id === id)?.range;
    range?.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function showChange(id: string) {
    const el = frame?.doc.querySelector(`[data-agent-note="${CSS.escape(id)}"]`);
    if (!el || !frame) return;
    const range = frame.doc.createRange();
    range.selectNodeContents(el);
    setActiveId(id);
    setChangeRange(range);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function focusFrame() {
    bodyRef.current?.querySelector<HTMLElement>("[data-agent-result-frame='true']")?.focus();
  }

  /** A pin: show its quote here and its note in the Agent panel. */
  function openNote(id: string) {
    reveal(id);
    openAgentPanel({ noteId: id });
  }

  // The Agent panel asks to show a note here, or to pick a new quote for it.
  const latest = useRef({ anchors, changeIds, reveal, showChange, focusFrame });
  latest.current = { anchors, changeIds, reveal, showChange, focusFrame };
  useEffect(() => {
    const mine = (event: Event) => {
      const detail = (event as CustomEvent<NoteRequestDetail>).detail;
      return detail.target === target && detail.itemId === itemId ? detail.noteId : null;
    };
    function onReveal(event: Event) {
      const id = mine(event);
      if (!id) return;
      if (latest.current.changeIds.has(id)) latest.current.showChange(id);
      else latest.current.reveal(id);
    }
    function onReattach(event: Event) {
      const id = mine(event);
      if (!id) return;
      setReattachId(id);
      latest.current.focusFrame();
    }
    window.addEventListener(REVEAL_NOTE_EVENT, onReveal);
    window.addEventListener(REATTACH_NOTE_EVENT, onReattach);
    return () => {
      window.removeEventListener(REVEAL_NOTE_EVENT, onReveal);
      window.removeEventListener(REATTACH_NOTE_EVENT, onReattach);
    };
  }, [target, itemId]);

  function startComment(request: CommentRequest) {
    if (reattachId) {
      const noteId = reattachId;
      setReattachId(null);
      actions.update.mutate({
        target,
        itemId,
        noteId,
        anchor: {
          quote: request.quote,
          quotePrefix: request.prefix,
          quoteSuffix: request.suffix,
          quoteOffset: request.offset,
          resultHash,
        },
      });
      openAgentPanel({ noteId });
      return;
    }
    // The note is written in the Agent panel, quoting the selection.
    openAgentPanel({
      quote: {
        quote: request.quote,
        prefix: request.prefix,
        suffix: request.suffix,
        offset: request.offset,
        resultFile: preview?.fileName ?? null,
        resultHash,
      },
    });
  }

  function openInBrowser() {
    if (!preview) return;
    setOpenError(null);
    openLocalPath(preview.filePath).catch((err) => setOpenError(commandErrorMessage(err)));
  }

  // Plain keys inside the result must not also drive the grid underneath
  // (j/k, c, a, ...). Modified chords still reach the app-level shortcuts.
  // Outside text fields: `o` opens the result file in the default browser,
  // `a` opens the Agent panel on this item. Escape on the panel itself
  // (focused from the grid) returns to the grid. The help key (F1 / `?` by default) still reaches the app-level handler.
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const editable = isEditableTarget(event.target);
    if (event.ctrlKey || event.metaKey || event.altKey || event.key === "Tab") return;
    if (event.key === "F1" || matchesCombo(resolveKeybindings().help, event)) return;
    event.stopPropagation();
    if (event.key === "Escape" && event.target === event.currentTarget) {
      event.preventDefault();
      focusPrimaryGrid();
      return;
    }
    if (editable) return;
    if ((event.key === "o" || event.key === "O") && preview) {
      event.preventDefault();
      openInBrowser();
    } else if ((event.key === "a" || event.key === "A")) {
      event.preventDefault();
      openAgentPanel();
    }
  }

  if (loading) {
    return (
      <div className="p-3">
        <LoadingState />
      </div>
    );
  }
  if (!hasFolder) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <PreviewEmptyState message={noFolderMessage} />
      </div>
    );
  }
  if (error) {
    return (
      <p className="p-3 text-2xs leading-4 text-destructive">
        {commandErrorMessage(error)}
      </p>
    );
  }

  const open = anchors.filter((a) => a.note.status !== "draft").length;
  const needs = anchors.filter((a) => a.tone === "needs").length;
  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2 p-3 outline-none"
      onKeyDown={handleKeyDown}
      onKeyDownCapture={(event) => {
        // Escape cancels a re-attach before the result frame takes it as "back to the grid".
        if (event.key !== "Escape" || !reattachId) return;
        event.preventDefault();
        event.stopPropagation();
        const id = reattachId;
        setReattachId(null);
        openAgentPanel({ noteId: id });
      }}
      {...(primaryPreview
        ? { "data-primary-preview": "true", "aria-keyshortcuts": "Control+P", tabIndex: -1 }
        : {})}
    >
      {openError ? <p className="shrink-0 text-2xs leading-4 text-destructive">{openError}</p> : null}
      {preview?.warning ? <p role="status" className="text-2xs text-warning">{preview.warning}</p> : null}
      <div className="flex shrink-0 items-center gap-1.5 text-2xs text-muted-foreground">
        <span>
          Select text and press C (or the Comment button) to ask the agent about it.
          {reattachId ? " Re-attach: select the new text for the note (Esc cancels)." : ""}
        </span>
        <span className="flex-1" />
        {needs ? <span className="rounded-full bg-red-500 px-1.5 text-3xs text-white">{needs} needs you</span> : null}
        {open ? <span className="rounded-full bg-yellow-400 px-1.5 text-3xs text-gray-900">{open} open</span> : null}
        <button
          type="button"
          onClick={() => openAgentPanel()}
          title="Open the Agent panel on this item (a)"
          aria-label="Open the Agent panel"
          className={headerButton}
        >
          <Bot className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        {preview ? (
          <button
            type="button"
            onClick={openInBrowser}
            title={`Open ${preview.fileName} in your browser (o)`}
            aria-label="Open the result in your browser"
            className={headerButton}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div ref={bodyRef} className="flex min-h-0 flex-1">
        {preview?.tooLarge ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded border border-border p-4">
            <p className="text-2xs">ファイルが大きすぎます（上限 5 MiB）。</p>
            <button type="button" onClick={openInBrowser} className={headerButton}>
              外部ブラウザで開く (o)
            </button>
          </div>
        ) : preview ? (
          <ResultFrame
            html={preview.html}
            title={frameTitle}
            frameRef={frameRef}
            frame={frame}
            onFrameLoad={handleFrameLoad}
            anchors={anchors}
            activeId={activeId}
            pendingRange={changeRange}
            onComment={startComment}
            onRevealNote={reveal}
            onOpenNote={openNote}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded border border-border p-4">
            <PreviewEmptyState message={`${noMatchMessage} You can still ask the agent in the Agent panel (a).`} />
          </div>
        )}
      </div>
    </div>
  );
}
