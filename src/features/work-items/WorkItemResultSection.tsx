import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import {
  commandErrorMessage,
  createAgentNote,
  deleteAgentNote,
  getAppSettings,
  getWorkItemResultPreview,
  listAgentNotes,
} from "@/lib/azdoCommands";
import { openLocalPath } from "@/lib/openExternal";
import { focusPrimaryGrid } from "@/lib/utils";
import { LoadingState, PreviewEmptyState } from "@/components/StateDisplay";
import { AgentNotesPane } from "./agent-notes/AgentNotesPane";
import { ResultFrame } from "./agent-notes/ResultFrame";
import { buildTextIndex, listBlocks, locateQuote } from "./agent-notes/resultAnchoring";
import type { CommentRequest, FrameState, NoteAnchor } from "./agent-notes/types";

// Mirrors the PR "Result" tab (PrSecondaryTabs.tsx), matching a locally
// generated HTML report by work item id instead of PR id. Rendered as its own
// dockable panel (see WorkItemsGrid.tsx) rather than a section embedded in
// the main preview, so it fills the height it's given instead of a fixed
// scroll box. Alongside the result it hosts agent notes: comments for the AI
// agent that produced the report, anchored to quoted text in it.
export function WorkItemResultSection({
  workItemId,
  commentModeRequest = 0,
}: {
  workItemId: number;
  commentModeRequest?: number;
}) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });

  const hasFolder = !!settingsQuery.data?.workItemResultFolderPath;

  const previewQuery = useQuery({
    queryKey: ["workItemResultPreview", workItemId],
    queryFn: () => getWorkItemResultPreview({ workItemId }),
    enabled: hasFolder,
  });
  // The agent edits these files outside DevDeck, so poll the (local) folder.
  const noteItem = { target: "work-item", itemId: workItemId } as const;
  const notesKey = ["agentNotes", noteItem.target, workItemId];
  const notesQuery = useQuery({
    queryKey: notesKey,
    queryFn: () => listAgentNotes(noteItem),
    enabled: hasFolder,
    refetchInterval: 15_000,
  });

  const preview = previewQuery.data ?? null;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<FrameState | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState<CommentRequest | null>(null);
  const [wide, setWide] = useState(true);
  const returnToRef = useRef<"block" | "grid">("grid");

  useEffect(() => {
    setFrame(null);
    setActiveId(null);
    setPending(null);
  }, [workItemId, preview?.html]);

  // The body (and ResultFrame) unmounts while a row's preview loads, so the
  // effects below key off whether it is currently rendered.
  const showsBody =
    hasFolder && !settingsQuery.isLoading && !previewQuery.isLoading && !previewQuery.isError;

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
    } else if (!hasFolder || (showsBody && !preview)) {
      handledCommentRequestRef.current = commentModeRequest;
    }
  }, [commentModeRequest, frame, hasFolder, showsBody, preview]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    // Side-by-side unless the panel is clearly portrait: a short panel docked
    // under the grid (common in Views) would otherwise leave the result a sliver.
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setWide(width >= 640 || width >= height * 1.2);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [showsBody]);

  const notes = notesQuery.data ?? [];
  const open: NoteAnchor[] = useMemo(() => {
    const located = notes
      .filter((n) => n.status === "open")
      .map((note) => ({
        note,
        range: frame
          ? locateQuote(frame.doc, frame.index, { quote: note.quote, prefix: note.quotePrefix, suffix: note.quoteSuffix })
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

  const createMutation = useMutation({
    mutationFn: createAgentNote,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notesKey }),
  });
  const deleteMutation = useMutation({
    mutationFn: (noteId: string) => deleteAgentNote({ ...noteItem, noteId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notesKey }),
  });

  function handleFrameLoad() {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.body) return;
    setFrame({ doc, index: buildTextIndex(doc), blocks: listBlocks(doc) });
  }

  function reveal(id: string) {
    setActiveId(id);
    const range = open.find((a) => a.note.id === id)?.range;
    const target = range?.startContainer.parentElement;
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function openNote(id: string) {
    reveal(id);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-agent-note-id="${CSS.escape(id)}"]`)
      ?.focus();
  }

  function startComment(request: CommentRequest) {
    returnToRef.current = request.origin === "block" ? "block" : "grid";
    setPending(request);
    composerRef.current?.focus();
  }

  function returnFocus() {
    const frameEl = bodyRef.current?.querySelector<HTMLElement>("[data-agent-result-frame='true']");
    if (returnToRef.current === "block" && frameEl) frameEl.focus();
    else focusPrimaryGrid();
    returnToRef.current = "grid";
  }

  async function send(body: string): Promise<boolean> {
    try {
      await createMutation.mutateAsync({
        ...noteItem,
        body,
        quote: pending?.quote ?? null,
        quotePrefix: pending?.prefix ?? null,
        quoteSuffix: pending?.suffix ?? null,
        resultFile: preview?.fileName ?? null,
      });
    } catch {
      return false;
    }
    setPending(null);
    returnFocus();
    return true;
  }

  // Plain keys inside the result/notes must not also drive the grid underneath
  // (j/k, c, a, ...). Modified chords still reach the app-level shortcuts.
  function containKeys(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key !== "Tab") event.stopPropagation();
  }

  function openInBrowser() {
    if (!preview) return;
    void openLocalPath(preview.filePath);
  }

  if (!hasFolder) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <PreviewEmptyState message="Set a work item result folder in Settings to see investigation output here." />
      </div>
    );
  }
  if (settingsQuery.isLoading || previewQuery.isLoading) {
    return (
      <div className="p-3">
        <LoadingState />
      </div>
    );
  }
  if (previewQuery.isError) {
    return (
      <p className="p-3 text-[11px] leading-4 text-destructive">
        {commandErrorMessage(previewQuery.error)}
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3" onKeyDown={containKeys}>
      {preview ? (
        <div className="flex shrink-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium" title={preview.fileName}>
              {preview.fileName}
            </p>
            <p className="truncate text-xs text-muted-foreground" title={preview.filePath}>
              {preview.filePath}
            </p>
          </div>
          <button
            type="button"
            onClick={openInBrowser}
            title="Open the review result in your browser"
            className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs font-medium hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            Open in browser
          </button>
        </div>
      ) : null}
      <div ref={bodyRef} className={`flex min-h-0 flex-1 gap-2 ${wide ? "flex-row" : "flex-col"}`}>
        {preview ? (
          <ResultFrame
            html={preview.html}
            title={`Review result preview for work item ${preview.workItemId}`}
            frameRef={frameRef}
            frame={frame}
            onFrameLoad={handleFrameLoad}
            anchors={open}
            activeId={activeId}
            pendingRange={pending?.range ?? null}
            onComment={startComment}
            onRevealNote={reveal}
            onOpenNote={openNote}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded border border-border p-4">
            <PreviewEmptyState message={`No HTML file matched work item ${workItemId}. You can still leave a note for the agent.`} />
          </div>
        )}
        <div
          className={`flex min-h-0 rounded border border-border bg-card ${
            wide ? "w-72 shrink-0" : "h-2/5 min-h-24"
          }`}
        >
          <AgentNotesPane
            key={workItemId}
            workItemId={workItemId}
            open={open}
            done={done}
            hasResult={!!preview}
            activeId={activeId}
            pendingQuote={pending?.quote ?? null}
            sending={createMutation.isPending}
            error={
              createMutation.error
                ? commandErrorMessage(createMutation.error)
                : notesQuery.error
                  ? commandErrorMessage(notesQuery.error)
                  : deleteMutation.error
                    ? commandErrorMessage(deleteMutation.error)
                    : null
            }
            composerRef={composerRef}
            listRef={listRef}
            onReveal={reveal}
            onDelete={(id) => deleteMutation.mutate(id)}
            onClearQuote={() => setPending(null)}
            onSend={send}
            onCancel={() => {
              setPending(null);
              returnFocus();
            }}
          />
        </div>
      </div>
    </div>
  );
}
