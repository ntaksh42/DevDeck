import { type ReactNode, memo, useState, useMemo } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown, Plus } from "lucide-react";
import {
  buildDiffLines,
  buildSideBySideRows,
  collapseDiff,
  type CollapsedItem,
  type DiffLine,
  type SideBySideCell,
} from "@/lib/diffView";
import { DiffLineText } from "@/components/DiffLineText";
import { openExternalUrl } from "@/lib/openExternal";
import {
  DIFF_CONTEXT_LINES,
  GAP_EXPAND_CHUNK,
  MAX_RENDERED_DIFF_LINES,
  UNAVAILABLE_MESSAGES,
  type CommentSide,
  type GapReveal,
  type ViewMode,
} from "./PrFilesTabTypes";

export function DiffContent({
  baseContent,
  targetContent,
  baseUnavailableReason,
  targetUnavailableReason,
  webUrl,
  viewMode,
  wholeFile,
  lineAttachments,
  lineHasContent,
  onStartComment,
}: {
  baseContent: string | null;
  targetContent: string | null;
  baseUnavailableReason: string | null;
  targetUnavailableReason: string | null;
  webUrl: string | null;
  viewMode: ViewMode;
  wholeFile: boolean;
  lineAttachments: (side: CommentSide, line: number | null) => ReactNode;
  lineHasContent: (side: CommentSide, line: number | null) => boolean;
  onStartComment: (side: CommentSide, line: number) => void;
}) {
  // Gaps the reader expanded, keyed by their first hidden line's numbers.
  const [gapReveal, setGapReveal] = useState<Map<string, GapReveal>>(() => new Map());

  const baseBlocked = baseUnavailableReason != null;
  const targetBlocked = targetUnavailableReason != null;
  // Only give up when neither side can be shown. A single blocked side still
  // renders (e.g. base too large → show the new file as additions).
  const fatalReason =
    baseBlocked && targetBlocked ? (targetUnavailableReason ?? baseUnavailableReason) : null;
  // A blocked side is treated as empty so the available side still diffs.
  const baseText = baseBlocked ? "" : baseContent ?? "";
  const targetText = targetBlocked ? "" : targetContent ?? "";
  const partialNote = fatalReason
    ? null
    : targetBlocked
      ? `New version unavailable (${UNAVAILABLE_MESSAGES[targetUnavailableReason!] ?? targetUnavailableReason}); showing the previous version.`
      : baseBlocked
        ? `Previous version unavailable (${UNAVAILABLE_MESSAGES[baseUnavailableReason!] ?? baseUnavailableReason}); showing the new file.`
        : null;

  const unified = useMemo(
    () => (fatalReason || viewMode !== "unified" ? [] : buildDiffLines(baseText, targetText)),
    [baseText, targetText, fatalReason, viewMode],
  );
  const split = useMemo(
    () => (fatalReason || viewMode !== "split" ? [] : buildSideBySideRows(baseText, targetText)),
    [baseText, targetText, fatalReason, viewMode],
  );

  // Fold unchanged runs, but never a line that carries a comment or open draft.
  // "Whole file" disables folding so every line of the file stays visible.
  const collapsedUnified = useMemo(
    () =>
      collapseDiff(
        unified,
        wholeFile
          ? () => false
          : (line) =>
              line.kind === "context" &&
              !lineHasContent("right", line.targetLine) &&
              !lineHasContent("left", line.baseLine),
        DIFF_CONTEXT_LINES,
      ),
    [unified, lineHasContent, wholeFile],
  );
  const collapsedSplit = useMemo(
    () =>
      collapseDiff(
        split,
        wholeFile
          ? () => false
          : (row) =>
              row.left?.kind === "context" &&
              row.right?.kind === "context" &&
              !lineHasContent("left", row.left.line) &&
              !lineHasContent("right", row.right.line),
        DIFF_CONTEXT_LINES,
      ),
    [split, lineHasContent, wholeFile],
  );

  if (fatalReason) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-xs text-muted-foreground">
        <span>{UNAVAILABLE_MESSAGES[fatalReason] ?? "Diff is not available."}</span>
        {webUrl ? (
          <button
            type="button"
            onClick={() => openExternalUrl(webUrl)}
            className="rounded border border-border bg-card px-2 py-0.5 text-xs hover:bg-secondary"
          >
            Open in browser
          </button>
        ) : null}
      </div>
    );
  }

  function revealGap(key: string, side: "top" | "bottom" | "all", total: number) {
    setGapReveal((prev) => {
      const next = new Map(prev);
      const current = next.get(key) ?? { top: 0, bottom: 0 };
      if (side === "all") {
        next.set(key, { top: total, bottom: 0 });
      } else {
        const room = total - current.top - current.bottom;
        const step = Math.min(GAP_EXPAND_CHUNK, room);
        next.set(
          key,
          side === "top"
            ? { ...current, top: current.top + step }
            : { ...current, bottom: current.bottom + step },
        );
      }
      return next;
    });
  }

  const note = partialNote ? (
    <p className="border-b border-border bg-yellow-50 px-2 py-1 text-[11px] text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300">
      {partialNote}
    </p>
  ) : null;

  if (viewMode === "split") {
    return (
      <div className="font-mono text-[11px] leading-4">
        {note}
        <CollapsedDiff
          items={collapsedSplit}
          gapReveal={gapReveal}
          onRevealGap={revealGap}
          gapKey={(row) => `${row.left?.line ?? ""}:${row.right?.line ?? ""}`}
          isChangedRow={(row) => row.left?.kind === "del" || row.right?.kind === "add"}
          renderRow={(row, key, isHunkStart) => (
            <div key={key} data-hunk-start={isHunkStart ? "true" : undefined}>
              <div className="grid grid-cols-2">
                <SplitCell cell={row.left} side="left" onStartComment={onStartComment} />
                <SplitCell cell={row.right} side="right" onStartComment={onStartComment} />
              </div>
              {lineAttachments("left", row.left ? row.left.line : null)}
              {lineAttachments("right", row.right ? row.right.line : null)}
            </div>
          )}
        />
      </div>
    );
  }

  return (
    <div className="font-mono text-[11px] leading-4">
      {note}
      <CollapsedDiff
        items={collapsedUnified}
        gapReveal={gapReveal}
        onRevealGap={revealGap}
        gapKey={(line) => `${line.baseLine ?? ""}:${line.targetLine ?? ""}`}
        isChangedRow={(line) => line.kind !== "context"}
        renderRow={(line, key, isHunkStart) => {
          // Deleted lines anchor to the old (left) file; everything else to new.
          const side: CommentSide = line.kind === "del" ? "left" : "right";
          const anchorLine = line.kind === "del" ? line.baseLine : line.targetLine;
          return (
            <div key={key} data-hunk-start={isHunkStart ? "true" : undefined}>
              <DiffRow line={line} onStartComment={onStartComment} />
              {lineAttachments(side, anchorLine)}
            </div>
          );
        }}
      />
    </div>
  );
}

/**
 * Renders a collapsed diff: visible rows plus "expand" bars for folded gaps.
 * The overall visible-row count is capped so a single huge change run cannot
 * lock up rendering.
 */
function CollapsedDiff<T>({
  items,
  gapReveal,
  onRevealGap,
  gapKey,
  isChangedRow,
  renderRow,
}: {
  items: CollapsedItem<T>[];
  gapReveal: Map<string, GapReveal>;
  onRevealGap: (key: string, side: "top" | "bottom" | "all", total: number) => void;
  gapKey: (row: T) => string;
  // A changed (add/del) row. Used to mark each hunk's first row with
  // `data-hunk-start` for the `[`/`]` navigation shortcut. Gaps only ever
  // fold unchanged (context) rows, so the row right after one is always a
  // hunk start without any special-casing here.
  isChangedRow: (row: T) => boolean;
  renderRow: (row: T, key: string, isHunkStart: boolean) => ReactNode;
}) {
  const out: ReactNode[] = [];
  let rendered = 0;
  let truncated = false;
  let prevChanged = false;

  function pushRows(rows: T[], from: number, to: number, prefix: string) {
    for (let k = from; k < to; k++) {
      if (rendered >= MAX_RENDERED_DIFF_LINES) {
        truncated = true;
        return;
      }
      const changed = isChangedRow(rows[k]);
      out.push(renderRow(rows[k], `${prefix}${k}`, changed && !prevChanged));
      prevChanged = changed;
      rendered += 1;
    }
  }

  for (let i = 0; i < items.length && !truncated; i++) {
    const item = items[i];
    if (item.type === "row") {
      pushRows([item.row], 0, 1, `r${i}-`);
      continue;
    }
    const key = gapKey(item.rows[0]);
    const total = item.rows.length;
    const reveal = gapReveal.get(key) ?? { top: 0, bottom: 0 };
    const middle = total - reveal.top - reveal.bottom;
    // Rows already revealed from the top of the gap.
    pushRows(item.rows, 0, reveal.top, `g${i}-`);
    if (truncated) break;
    if (middle > 0) {
      out.push(
        <GapBar
          key={`gap${i}`}
          count={middle}
          onExpandUp={() => onRevealGap(key, "top", total)}
          onExpandDown={() => onRevealGap(key, "bottom", total)}
          onExpandAll={() => onRevealGap(key, "all", total)}
        />,
      );
    }
    // Rows already revealed from the bottom of the gap.
    pushRows(item.rows, total - reveal.bottom, total, `g${i}-`);
  }

  return (
    <>
      {out}
      {truncated ? <TruncationNote /> : null}
    </>
  );
}

function GapBar({
  count,
  onExpandUp,
  onExpandDown,
  onExpandAll,
}: {
  count: number;
  onExpandUp: () => void;
  onExpandDown: () => void;
  onExpandAll: () => void;
}) {
  const cls =
    "flex items-center justify-center hover:bg-muted/70 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-ring";
  return (
    <div className="flex w-full items-stretch border-y border-border/60 bg-muted/40 text-[11px] text-muted-foreground">
      <button
        type="button"
        onClick={onExpandUp}
        title={`Expand ${GAP_EXPAND_CHUNK} lines up`}
        aria-label="Expand up"
        className={`${cls} w-7`}
      >
        <ChevronUp className="h-3 w-3" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onExpandAll}
        className={`${cls} flex-1 gap-1 border-x border-border/60 py-0.5`}
      >
        <ChevronsUpDown className="h-3 w-3" aria-hidden="true" />
        Expand {count} unchanged line{count === 1 ? "" : "s"}
      </button>
      <button
        type="button"
        onClick={onExpandDown}
        title={`Expand ${GAP_EXPAND_CHUNK} lines down`}
        aria-label="Expand down"
        className={`${cls} w-7`}
      >
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}

function TruncationNote() {
  return (
    <p className="px-2 py-1 text-[11px] italic text-muted-foreground">
      Diff truncated to the first {MAX_RENDERED_DIFF_LINES} lines.
    </p>
  );
}

function rowBackground(kind: SideBySideCell["kind"] | DiffLine["kind"]): string {
  return kind === "add"
    ? "bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-200"
    : kind === "del"
      ? "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200"
      : "";
}

/** Renders line text, highlighting the changed words of a partial edit. */
function CommentLineButton({
  side,
  line,
  onStartComment,
}: {
  side: CommentSide;
  line: number;
  onStartComment: (side: CommentSide, line: number) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Comment on ${side === "left" ? "old " : ""}line ${line}`}
      onClick={() => onStartComment(side, line)}
      className="invisible absolute inset-y-0 left-0 flex w-4 items-center justify-center rounded-sm bg-primary text-primary-foreground group-hover:visible"
    >
      <Plus className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}

// Memoized so toolbar/comment-box state changes don't re-render every diff row.
const DiffRow = memo(function DiffRow({
  line,
  onStartComment,
}: {
  line: DiffLine;
  onStartComment: (side: CommentSide, line: number) => void;
}) {
  const marker = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
  return (
    <div className={`group grid grid-cols-[3rem_3rem_1fr] ${rowBackground(line.kind)}`}>
      <span className="relative select-none border-r border-border/60 pr-1 text-right text-muted-foreground/70">
        {line.kind === "del" && line.baseLine != null ? (
          <CommentLineButton side="left" line={line.baseLine} onStartComment={onStartComment} />
        ) : null}
        {line.baseLine ?? ""}
      </span>
      <span className="relative select-none border-r border-border/60 pr-1 text-right text-muted-foreground/70">
        {line.kind !== "del" && line.targetLine != null ? (
          <CommentLineButton side="right" line={line.targetLine} onStartComment={onStartComment} />
        ) : null}
        {line.targetLine ?? ""}
      </span>
      <span className="whitespace-pre pl-1">
        {marker}
        <DiffLineText segments={line.segments} text={line.text} kind={line.kind} />
      </span>
    </div>
  );
});

const SplitCell = memo(function SplitCell({
  cell,
  side,
  onStartComment,
}: {
  cell: SideBySideCell | null;
  side: CommentSide;
  onStartComment: (side: CommentSide, line: number) => void;
}) {
  if (!cell) {
    return <div className="border-r border-border/60 bg-muted/20" aria-hidden="true" />;
  }
  return (
    <div className={`group grid min-w-0 grid-cols-[3rem_1fr] border-r border-border/60 ${rowBackground(cell.kind)}`}>
      <span className="relative select-none border-r border-border/60 pr-1 text-right text-muted-foreground/70">
        <CommentLineButton side={side} line={cell.line} onStartComment={onStartComment} />
        {cell.line}
      </span>
      {/* Wrap long lines so split view no longer needs a switch to unified. */}
      <span className="whitespace-pre-wrap break-all pl-1">
        <DiffLineText segments={cell.segments} text={cell.text} kind={cell.kind} />
      </span>
    </div>
  );
});
