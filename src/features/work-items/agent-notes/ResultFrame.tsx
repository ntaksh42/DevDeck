import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { MessageSquarePlus } from "lucide-react";
import { useLatestRef } from "@/lib/useLatestRef";
import { focusPrimaryGrid } from "@/lib/utils";
import { anchorFromRange, blockSpanRange, collapseWhitespace } from "./resultAnchoring";
import type { CommentRequest, FrameState, NoteAnchor } from "./types";

// Renders the investigation result in a script-less sandboxed iframe and layers
// the agent-note UI on top from the parent document: highlights via the CSS
// Custom Highlight API, numbered gutter pins, scrollbar marks, a keyboard
// "comment mode" that walks the result block by block, and a Comment button
// for mouse selections. The result HTML itself is never modified on disk.

const HIGHLIGHT_CSS =
  "::highlight(agent-note){background:rgba(250,204,21,.5)}" +
  "::highlight(agent-block){background:rgba(59,130,246,.16)}" +
  "::highlight(agent-active){background:rgba(249,115,22,.55)}";
const PIN = 16;

type HighlightWindow = Window & {
  Highlight?: new (...ranges: Range[]) => { priority: number };
  CSS: { highlights?: Map<string, unknown> };
};
type Marker = { id: string; num: number; pinTop: number | null; markTop: number };

type Props = {
  html: string;
  title: string;
  frameRef: RefObject<HTMLIFrameElement | null>;
  frame: FrameState | null;
  onFrameLoad: () => void;
  anchors: NoteAnchor[];
  activeId: string | null;
  pendingRange: Range | null;
  onComment: (request: CommentRequest) => void;
  onRevealNote: (id: string) => void;
  onOpenNote: (id: string) => void;
};

export function ResultFrame({
  html, title, frameRef, frame, onFrameLoad, anchors, activeId, pendingRange,
  onComment, onRevealNote, onOpenNote,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [blockMode, setBlockMode] = useState(false);
  const [blockIdx, setBlockIdx] = useState(0);
  const [blockAnchor, setBlockAnchor] = useState<number | null>(null);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [selection, setSelection] = useState<{ range: Range; top: number; left: number } | null>(null);
  const anchorsRef = useLatestRef(anchors);
  const lastScrollRef = useRef<number | null>(null);

  const blocks = frame?.blocks ?? [];
  const safeIdx = Math.min(blockIdx, Math.max(0, blocks.length - 1));

  useEffect(() => {
    setBlockIdx(0);
    setBlockAnchor(null);
    setSelection(null);
  }, [frame]);

  const updateMarkers = useCallback(() => {
    const iframe = frameRef.current, wrap = wrapRef.current, win = iframe?.contentWindow;
    if (!iframe || !wrap || !win || !frame) {
      setMarkers((prev) => (prev.length ? [] : prev));
      return;
    }
    const fr = iframe.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    const offset = fr.top - wr.top;
    const trackHeight = Math.max(0, fr.height - 8);
    const docHeight = Math.max(1, win.document.documentElement.scrollHeight);
    let lastPin = -Infinity;
    const next: Marker[] = [];
    for (const { note, num, range } of anchorsRef.current) {
      if (!range || num == null) continue;
      const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
      let pinTop: number | null = null;
      if (rect.bottom > 0 && rect.top < fr.height) {
        pinTop = Math.max(offset + rect.top + (rect.height - PIN) / 2, lastPin + PIN + 2, offset);
        lastPin = pinTop;
      }
      const markTop = offset + 4 + Math.min(trackHeight - 4, ((rect.top + win.scrollY) / docHeight) * trackHeight);
      next.push({ id: note.id, num, pinTop, markTop });
    }
    lastScrollRef.current = win.scrollY;
    setMarkers((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [anchorsRef, frame, frameRef]);

  // Paint highlights whenever notes, the active note, or the block cursor change.
  useEffect(() => {
    const win = frameRef.current?.contentWindow as HighlightWindow | null | undefined;
    const registry = win?.CSS?.highlights;
    if (!frame || !win?.Highlight || !registry) return;
    const ranges = anchors.flatMap((a) => (a.range ? [a.range] : []));
    registry.set("agent-note", new win.Highlight(...ranges));
    if (blockMode && blocks.length) {
      const anchor = blockAnchor ?? safeIdx;
      registry.set("agent-block", new win.Highlight(blockSpanRange(frame.doc, blocks, anchor, safeIdx)));
    } else registry.delete("agent-block");
    const active = pendingRange ?? anchors.find((a) => a.note.id === activeId)?.range ?? null;
    if (active) {
      const highlight = new win.Highlight(active);
      highlight.priority = 2;
      registry.set("agent-active", highlight);
    } else registry.delete("agent-active");
    updateMarkers();
  }, [frame, anchors, activeId, pendingRange, blockMode, blockAnchor, safeIdx, blocks, frameRef, updateMarkers]);

  // The sandbox disables scripts inside the result, so scroll and selection
  // are observed from here by polling rather than with in-frame listeners.
  useEffect(() => {
    if (!frame) return;
    const timer = window.setInterval(() => {
      const iframe = frameRef.current, win = iframe?.contentWindow, wrap = wrapRef.current;
      if (!iframe || !win || !wrap) return;
      if (win.scrollY !== lastScrollRef.current) updateMarkers();
      const sel = win.document.getSelection();
      if (!sel || sel.isCollapsed || !collapseWhitespace(sel.toString())) {
        setSelection((prev) => (prev ? null : prev));
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const fr = iframe.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      const top = Math.min(fr.bottom - wr.top - 28, Math.max(4, fr.top - wr.top + rect.bottom + 4));
      const left = Math.min(wr.width - 100, Math.max(4, fr.left - wr.left + rect.left));
      setSelection((prev) =>
        prev && prev.top === top && prev.left === left ? prev : { range: range.cloneRange(), top, left },
      );
    }, 150);
    const observer = new ResizeObserver(() => updateMarkers());
    if (wrapRef.current) observer.observe(wrapRef.current);
    return () => {
      window.clearInterval(timer);
      observer.disconnect();
    };
  }, [frame, frameRef, updateMarkers]);

  function handleLoad() {
    const doc = frameRef.current?.contentDocument;
    if (doc?.head) {
      const style = doc.createElement("style");
      style.textContent = HIGHLIGHT_CSS;
      doc.head.appendChild(style);
    }
    onFrameLoad();
  }

  const notesOnBlock = (i: number) =>
    anchors.filter((a) => a.range && blocks[i] && a.range.intersectsNode(blocks[i]));

  function moveBlock(next: number, extend: boolean) {
    const clamped = Math.max(0, Math.min(blocks.length - 1, next));
    setBlockAnchor(extend ? (blockAnchor ?? safeIdx) : null);
    setBlockIdx(clamped);
    blocks[clamped]?.scrollIntoView({ block: "nearest" });
  }

  function commentOnBlocks() {
    if (!frame || !blocks.length) return;
    const range = blockSpanRange(frame.doc, blocks, blockAnchor ?? safeIdx, safeIdx);
    const anchor = anchorFromRange(frame.index, range);
    if (anchor) onComment({ ...anchor, range, origin: "block" });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.target !== wrapRef.current) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (key === "Escape") {
      handled();
      if (blockAnchor != null) setBlockAnchor(null);
      else focusPrimaryGrid();
      return;
    }
    if (!blocks.length) return;
    if (key === "ArrowDown" || key === "ArrowUp") {
      handled();
      moveBlock(safeIdx + (key === "ArrowDown" ? 1 : -1), event.shiftKey);
    } else if (key === "Home" || key === "End") {
      handled();
      moveBlock(key === "Home" ? 0 : blocks.length - 1, event.shiftKey);
    } else if (key === "PageDown" || key === "PageUp") {
      handled();
      const win = frameRef.current?.contentWindow;
      win?.scrollBy(0, (key === "PageDown" ? 1 : -1) * win.innerHeight * 0.85);
    } else if (key === "]" || key === "[") {
      handled();
      const step = key === "]" ? 1 : -1;
      for (let i = safeIdx + step; i >= 0 && i < blocks.length; i += step) {
        const found = notesOnBlock(i);
        if (found.length) {
          setBlockAnchor(null);
          setBlockIdx(i);
          blocks[i].scrollIntoView({ block: "center" });
          onRevealNote(found[0].note.id);
          break;
        }
      }
    } else if (key === "Enter" && blockAnchor == null && notesOnBlock(safeIdx).length) {
      handled();
      onOpenNote(notesOnBlock(safeIdx)[0].note.id);
    } else if (key === "Enter" || key === "c" || key === "C") {
      handled();
      commentOnBlocks();
    }
  }

  function commentOnSelection() {
    if (!selection || !frame) return;
    const anchor = anchorFromRange(frame.index, selection.range);
    frameRef.current?.contentDocument?.getSelection()?.removeAllRanges();
    setSelection(null);
    if (anchor) onComment({ ...anchor, range: selection.range, origin: "mouse" });
  }

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="region"
      aria-label="Investigation result. Comment mode: arrow keys move between blocks, C comments, Enter opens a note, Escape returns to the grid."
      data-agent-result-frame="true"
      onKeyDown={handleKeyDown}
      onFocus={(e) => e.target === wrapRef.current && setBlockMode(true)}
      onBlur={(e) => e.target === wrapRef.current && setBlockMode(false)}
      className={`relative flex min-h-0 flex-1 rounded border bg-card py-0 pl-6 pr-3 outline-none ${
        blockMode ? "border-primary ring-1 ring-primary" : "border-border"
      }`}
    >
      {/* `allow-same-origin` (without `allow-scripts`) is required for the
          WebView2 desktop runtime to render a `srcDoc` document at all, and
          lets this component read the selection and paint highlights. */}
      <iframe
        ref={frameRef}
        title={title}
        sandbox="allow-same-origin"
        srcDoc={html}
        tabIndex={-1}
        onLoad={handleLoad}
        className="min-h-0 w-full flex-1 bg-white outline-none"
      />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-6 overflow-hidden">
        {markers.map((m) =>
          m.pinTop == null ? null : (
            <button
              key={m.id}
              type="button"
              tabIndex={-1}
              title={`Note ${m.num}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => onRevealNote(m.id)}
              onClick={() => onOpenNote(m.id)}
              style={{ top: m.pinTop }}
              className={`pointer-events-auto absolute left-1 h-4 w-4 rounded-full text-[10px] font-bold leading-4 shadow ${
                m.id === activeId ? "bg-orange-500 text-white" : "bg-yellow-400 text-gray-900 hover:bg-yellow-500"
              }`}
            >
              {m.num}
            </button>
          ),
        )}
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0.5 w-1.5">
        {markers.map((m) => (
          <button
            key={m.id}
            type="button"
            tabIndex={-1}
            aria-label={`Scroll to note ${m.num}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onRevealNote(m.id)}
            style={{ top: m.markTop }}
            className={`pointer-events-auto absolute left-0 h-1 w-1.5 rounded-sm ${
              m.id === activeId ? "bg-orange-500" : "bg-yellow-500 hover:bg-yellow-600"
            }`}
          />
        ))}
      </div>
      {selection ? (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={commentOnSelection}
          style={{ top: selection.top, left: selection.left }}
          className="absolute z-10 inline-flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
          Comment
        </button>
      ) : null}
      {blockMode ? (
        <p className="pointer-events-none absolute right-4 top-1 rounded-full bg-primary px-2 text-[10px] text-primary-foreground">
          ↑↓ move · Shift extend · C comment · Enter open note · ] [ next/prev note · Esc grid
        </p>
      ) : null}
    </div>
  );
}
