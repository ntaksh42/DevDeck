import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, ExternalLink } from "lucide-react";
import {
  commandErrorMessage,
  getAppSettings,
  noteNeedsYou,
  type AgentNoteItem,
  type AgentNoteKind,
} from "@/lib/azdoCommands";
import { openLocalPath } from "@/lib/openExternal";
import { matchesCombo, resolveKeybindings } from "@/lib/keybindings";
import { focusPrimaryGrid, isEditableTarget } from "@/lib/utils";
import { LoadingState, PreviewEmptyState } from "@/components/StateDisplay";
import { AgentNotesPane } from "./AgentNotesPane";
import { PaneSplitter, useNotesSize } from "./PaneSplitter";
import { ResultFrame } from "./ResultFrame";
import { lastAgentReplyAt, markItemSeen } from "./noteSeen";
import { buildTextIndex, hashResult, listBlocks, locateQuote } from "./resultAnchoring";
import { useAgentNoteActions } from "./useAgentNoteActions";
import type { CommentRequest, FrameState, NoteAnchor } from "./types";

type ResultPreview = { fileName: string; filePath: string; html: string };

const headerButton =
  "shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

// A locally generated result HTML (work item investigation or PR review) with
// agent notes alongside it: comments for the AI agent that produced the report,
// anchored to quoted text in it. Callers own the result/settings queries; this
// component owns the notes.
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
  const settingsQuery = useQuery({ queryKey: ["appSettings"], queryFn: getAppSettings, staleTime: 5 * 60_000 });
  const canRunAgent = !!settingsQuery.data?.agentCommand;

  const frameRef = useRef<HTMLIFrameElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<FrameState | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState<CommentRequest | null>(null);
  const [changeRange, setChangeRange] = useState<Range | null>(null);
  const [reattachId, setReattachId] = useState<string | null>(null);
  const [wide, setWide] = useState(true);
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 });
  const [notesSize, setNotesSize] = useNotesSize(wide);
  const [openError, setOpenError] = useState<string | null>(null);
  const returnToRef = useRef<"block" | "grid">("grid");
  const resultHash = useMemo(() => (preview ? hashResult(preview.html) : null), [preview]);

  useEffect(() => {
    setFrame(null);
    setActiveId(null);
    setPending(null);
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
    } else if ((!hasFolder && !loading) || (showsBody && !preview)) {
      handledCommentRequestRef.current = commentModeRequest;
    }
  }, [commentModeRequest, frame, hasFolder, loading, showsBody, preview]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    // Side-by-side unless the panel is clearly portrait: a short panel docked
    // under the grid (common in Views) would otherwise leave the result a sliver.
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setWide(width >= 640 || width >= height * 1.2);
      setBodySize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [showsBody]);

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

  function focusNote(id: string) {
    listRef.current?.querySelector<HTMLElement>(`[data-agent-note-id="${CSS.escape(id)}"]`)?.focus();
  }

  function openNote(id: string) {
    reveal(id);
    focusNote(id);
  }

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
      focusNote(noteId);
      return;
    }
    returnToRef.current = request.origin === "block" ? "block" : "grid";
    setPending(request);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  function returnFocus() {
    const frameEl = bodyRef.current?.querySelector<HTMLElement>("[data-agent-result-frame='true']");
    if (returnToRef.current === "block" && frameEl) frameEl.focus();
    else focusPrimaryGrid();
    returnToRef.current = "grid";
  }

  async function send(body: string, kind: AgentNoteKind, draft: boolean): Promise<boolean> {
    try {
      await actions.create.mutateAsync({
        target,
        itemId,
        body,
        quote: pending?.quote ?? null,
        quotePrefix: pending?.prefix ?? null,
        quoteSuffix: pending?.suffix ?? null,
        quoteOffset: pending?.offset ?? null,
        resultFile: preview?.fileName ?? null,
        resultHash,
        kind: kind === "fix" ? null : kind,
        draft,
      });
    } catch {
      return false;
    }
    setPending(null);
    returnFocus();
    return true;
  }

  function openInBrowser() {
    if (!preview) return;
    setOpenError(null);
    openLocalPath(preview.filePath).catch((err) => setOpenError(commandErrorMessage(err)));
  }

  // Plain keys inside the result/notes must not also drive the grid underneath
  // (j/k, c, a, ...). Modified chords still reach the app-level shortcuts.
  // Outside text fields: `o` opens the result file in the default browser,
  // `a` runs the agent, Ctrl+Z undoes a note delete. Escape on the panel
  // itself (focused from the grid) returns to the grid. The help key (F1 / `?` by default) still reaches the app-level handler.
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const editable = isEditableTarget(event.target);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !editable && actions.deleted) {
      event.preventDefault();
      event.stopPropagation();
      actions.undoDelete();
      return;
    }
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
    } else if ((event.key === "a" || event.key === "A") && canRunAgent) {
      event.preventDefault();
      actions.run.mutate();
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
      <p className="p-3 text-[11px] leading-4 text-destructive">
        {commandErrorMessage(error)}
      </p>
    );
  }

  const maxNotes = Math.max(180, (wide ? bodySize.width : bodySize.height) - 220);
  const shownSize = Math.min(notesSize, maxNotes);
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
        focusNote(id);
      }}
      {...(primaryPreview
        ? { "data-primary-preview": "true", "aria-keyshortcuts": "Control+P", tabIndex: -1 }
        : {})}
    >
      {openError ? <p className="shrink-0 text-[11px] leading-4 text-destructive">{openError}</p> : null}
      <div ref={bodyRef} className={`flex min-h-0 flex-1 gap-1 ${wide ? "flex-row" : "flex-col"}`}>
        {preview ? (
          <ResultFrame
            html={preview.html}
            title={frameTitle}
            frameRef={frameRef}
            frame={frame}
            onFrameLoad={handleFrameLoad}
            anchors={anchors}
            activeId={activeId}
            pendingRange={pending?.range ?? changeRange}
            onComment={startComment}
            onRevealNote={reveal}
            onOpenNote={openNote}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded border border-border p-4">
            <PreviewEmptyState message={`${noMatchMessage} You can still leave a note for the agent.`} />
          </div>
        )}
        <PaneSplitter wide={wide} size={shownSize} max={maxNotes} onResize={setNotesSize} />
        <div
          className="flex min-h-0 shrink-0 rounded border border-border bg-card"
          style={wide ? { width: shownSize } : { height: shownSize }}
        >
          <AgentNotesPane
            key={`${target}:${itemId}`}
            item={item}
            folderName={`${target === "pull-request" ? "pr" : "wi"}-${itemId}`}
            anchors={anchors}
            done={done}
            hasResult={!!preview}
            resultHash={resultHash}
            activeId={activeId}
            pendingQuote={pending?.quote ?? null}
            reattachId={reattachId}
            changeIds={changeIds}
            actions={actions}
            composerRef={composerRef}
            listRef={listRef}
            onReveal={reveal}
            onShowChange={showChange}
            onReattach={(id) => {
              setReattachId(id);
              if (id) bodyRef.current?.querySelector<HTMLElement>("[data-agent-result-frame='true']")?.focus();
            }}
            onSend={send}
            onClearQuote={() => setPending(null)}
            onCancel={() => {
              setPending(null);
              returnFocus();
            }}
            headerActions={
              <>
                {canRunAgent ? (
                  <button
                    type="button"
                    onClick={() => actions.run.mutate()}
                    disabled={actions.run.isPending}
                    title="Run the agent on these notes (a)"
                    aria-label="Run the agent"
                    className={headerButton}
                  >
                    <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : null}
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
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}
