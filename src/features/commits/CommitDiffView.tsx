import { useMemo, useState } from "react";
import { ChevronsUpDown, Columns2, Rows2 } from "lucide-react";
import {
  buildDiffLines,
  buildSideBySideRows,
  collapseDiff,
  type CollapsedItem,
  type DiffLine,
  type DiffLineKind,
  type SideBySideCell,
  type SideBySideRow,
} from "@/lib/diffView";
import { highlightLines } from "@/lib/highlight";
import { DiffLineText } from "@/components/DiffLineText";

const MAX_RENDERED_DIFF_LINES = 2000;

export type DiffViewMode = "unified" | "side-by-side";

const UNAVAILABLE_MESSAGES: Record<string, string> = {
  binary: "Binary file — diff is not available.",
  tooLarge: "File is too large to diff in the app.",
  missing: "File content could not be loaded.",
};

/** Unified / side-by-side diff display toggle. A plain two-button group, so
 * the whole control is reachable with Tab and each option activates with
 * Enter/Space like any other button — no custom key handling needed. */
export function DiffViewModeToggle({
  viewMode,
  onChange,
}: {
  viewMode: DiffViewMode;
  onChange: (mode: DiffViewMode) => void;
}) {
  const baseCls = "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-ring";
  return (
    <div role="group" aria-label="Diff display mode" className="flex items-center gap-0.5 rounded border border-border bg-card p-0.5">
      <button
        type="button"
        aria-pressed={viewMode === "unified"}
        onClick={() => onChange("unified")}
        className={`${baseCls} ${viewMode === "unified" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
      >
        <Rows2 className="h-3 w-3" aria-hidden="true" /> Unified
      </button>
      <button
        type="button"
        aria-pressed={viewMode === "side-by-side"}
        onClick={() => onChange("side-by-side")}
        className={`${baseCls} ${viewMode === "side-by-side" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
      >
        <Columns2 className="h-3 w-3" aria-hidden="true" /> Side-by-side
      </button>
    </div>
  );
}

function rowBackground(kind: DiffLineKind): string {
  return kind === "add"
    ? "bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-200"
    : kind === "del"
      ? "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200"
      : "";
}

/** Renders a diff line's content: word-level highlight segments take priority
 * (an exact-change overlay computed from the diff itself); otherwise falls
 * back to syntax-highlighted HTML for that line, since combining both overlays
 * on the same text is not attempted. */
function DiffLineContent({
  segments,
  text,
  kind,
  html,
}: {
  segments?: { text: string; highlight: boolean }[];
  text: string;
  kind: DiffLineKind;
  html: string | null;
}) {
  if (segments) {
    return <DiffLineText segments={segments} text={text} kind={kind} />;
  }
  if (html != null) {
    return <span dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <>{text}</>;
}

/** Expand-gap affordance shared by the unified and side-by-side renderers. */
function GapButton({ hiddenCount, onExpand }: { hiddenCount: number; onExpand: () => void }) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="flex w-full items-center justify-center gap-1 border-y border-border/60 bg-muted/40 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/70"
    >
      <ChevronsUpDown className="h-3 w-3" aria-hidden="true" />
      Expand {hiddenCount} unchanged line{hiddenCount === 1 ? "" : "s"}
    </button>
  );
}

export function CommitDiffView({
  filePath,
  viewMode,
  baseContent,
  targetContent,
  baseUnavailableReason,
  targetUnavailableReason,
}: {
  filePath: string;
  viewMode: DiffViewMode;
  baseContent: string | null;
  targetContent: string | null;
  baseUnavailableReason: string | null;
  targetUnavailableReason: string | null;
}) {
  const [expandedGaps, setExpandedGaps] = useState<Set<number>>(() => new Set());

  const baseBlocked = baseUnavailableReason != null;
  const targetBlocked = targetUnavailableReason != null;
  const fatalReason =
    baseBlocked && targetBlocked ? (targetUnavailableReason ?? baseUnavailableReason) : null;
  const baseText = baseBlocked ? "" : baseContent ?? "";
  const targetText = targetBlocked ? "" : targetContent ?? "";

  // Highlighted once per side (not per diff line) so a token spanning
  // multiple lines (a block comment, a multi-line string) still tokenizes
  // correctly; see `highlightLines`.
  const highlightedBase = useMemo(
    () => (fatalReason ? [] : highlightLines(baseText, filePath)),
    [baseText, filePath, fatalReason],
  );
  const highlightedTarget = useMemo(
    () => (fatalReason ? [] : highlightLines(targetText, filePath)),
    [targetText, filePath, fatalReason],
  );

  if (fatalReason) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        {UNAVAILABLE_MESSAGES[fatalReason] ?? "Diff is not available."}
      </p>
    );
  }

  const partialNote = targetBlocked
    ? `New version unavailable (${UNAVAILABLE_MESSAGES[targetUnavailableReason!] ?? targetUnavailableReason}); showing the previous version.`
    : baseBlocked
      ? `Previous version unavailable (${UNAVAILABLE_MESSAGES[baseUnavailableReason!] ?? baseUnavailableReason}); showing the new file.`
      : null;

  return (
    <div className="font-mono text-[11px] leading-4">
      {partialNote ? (
        <p className="border-b border-border bg-yellow-50 px-2 py-1 text-[11px] text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300">
          {partialNote}
        </p>
      ) : null}
      {viewMode === "unified" ? (
        <UnifiedDiff
          baseText={baseText}
          targetText={targetText}
          highlightedBase={highlightedBase}
          highlightedTarget={highlightedTarget}
          expandedGaps={expandedGaps}
          setExpandedGaps={setExpandedGaps}
        />
      ) : (
        <SideBySideDiff
          baseText={baseText}
          targetText={targetText}
          highlightedBase={highlightedBase}
          highlightedTarget={highlightedTarget}
          expandedGaps={expandedGaps}
          setExpandedGaps={setExpandedGaps}
        />
      )}
    </div>
  );
}

function lineHtml(lineNumber: number | null, highlighted: string[]): string | null {
  if (lineNumber == null) return null;
  return highlighted[lineNumber - 1] ?? null;
}

function UnifiedDiff({
  baseText,
  targetText,
  highlightedBase,
  highlightedTarget,
  expandedGaps,
  setExpandedGaps,
}: {
  baseText: string;
  targetText: string;
  highlightedBase: string[];
  highlightedTarget: string[];
  expandedGaps: Set<number>;
  setExpandedGaps: (updater: (prev: Set<number>) => Set<number>) => void;
}) {
  const collapsed = useMemo(() => {
    const lines = buildDiffLines(baseText, targetText);
    return collapseDiff(lines, (line) => line.kind === "context");
  }, [baseText, targetText]);

  let rendered = 0;
  const out: React.ReactNode[] = [];
  for (let i = 0; i < collapsed.length && rendered < MAX_RENDERED_DIFF_LINES; i++) {
    const item: CollapsedItem<DiffLine> = collapsed[i];
    if (item.type === "gap" && !expandedGaps.has(i)) {
      out.push(
        <GapButton
          key={`gap${i}`}
          hiddenCount={item.rows.length}
          onExpand={() => setExpandedGaps((prev) => new Set(prev).add(i))}
        />,
      );
      continue;
    }
    const rows = item.type === "row" ? [item.row] : item.rows;
    for (const line of rows) {
      if (rendered >= MAX_RENDERED_DIFF_LINES) break;
      const marker = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
      const html =
        line.kind === "add"
          ? lineHtml(line.targetLine, highlightedTarget)
          : lineHtml(line.baseLine, highlightedBase);
      out.push(
        <div
          key={`l${i}-${rendered}`}
          className={`grid grid-cols-[3rem_3rem_1fr] ${rowBackground(line.kind)}`}
        >
          <span className="select-none border-r border-border/60 pr-1 text-right text-muted-foreground/70">
            {line.baseLine ?? ""}
          </span>
          <span className="select-none border-r border-border/60 pr-1 text-right text-muted-foreground/70">
            {line.targetLine ?? ""}
          </span>
          <span className="whitespace-pre-wrap break-all pl-1">
            {marker}
            <DiffLineContent segments={line.segments} text={line.text} kind={line.kind} html={html} />
          </span>
        </div>,
      );
      rendered += 1;
    }
  }

  return (
    <>
      {out}
      {rendered >= MAX_RENDERED_DIFF_LINES ? (
        <p className="px-2 py-1 text-[11px] italic text-muted-foreground">
          Diff truncated to the first {MAX_RENDERED_DIFF_LINES} lines.
        </p>
      ) : null}
    </>
  );
}

function sideCellBackground(kind: DiffLineKind | undefined): string {
  if (kind === "add") return "bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-200";
  if (kind === "del") return "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200";
  return "";
}

function SideBySideCellView({
  cell,
  highlighted,
}: {
  cell: SideBySideCell | null;
  highlighted: string[];
}) {
  return (
    <>
      <span className="select-none border-r border-border/60 pr-1 text-right text-muted-foreground/70">
        {cell?.line ?? ""}
      </span>
      <span className={`whitespace-pre-wrap break-all pl-1 ${sideCellBackground(cell?.kind)}`}>
        {cell ? (
          <DiffLineContent
            segments={cell.segments}
            text={cell.text}
            kind={cell.kind}
            html={lineHtml(cell.line, highlighted)}
          />
        ) : null}
      </span>
    </>
  );
}

function SideBySideDiff({
  baseText,
  targetText,
  highlightedBase,
  highlightedTarget,
  expandedGaps,
  setExpandedGaps,
}: {
  baseText: string;
  targetText: string;
  highlightedBase: string[];
  highlightedTarget: string[];
  expandedGaps: Set<number>;
  setExpandedGaps: (updater: (prev: Set<number>) => Set<number>) => void;
}) {
  const collapsed = useMemo(() => {
    const rows = buildSideBySideRows(baseText, targetText);
    return collapseDiff(rows, (row) => row.left?.kind === "context" && row.right?.kind === "context");
  }, [baseText, targetText]);

  let rendered = 0;
  const out: React.ReactNode[] = [];
  for (let i = 0; i < collapsed.length && rendered < MAX_RENDERED_DIFF_LINES; i++) {
    const item: CollapsedItem<SideBySideRow> = collapsed[i];
    if (item.type === "gap" && !expandedGaps.has(i)) {
      out.push(
        <GapButton
          key={`gap${i}`}
          hiddenCount={item.rows.length}
          onExpand={() => setExpandedGaps((prev) => new Set(prev).add(i))}
        />,
      );
      continue;
    }
    const rows = item.type === "row" ? [item.row] : item.rows;
    for (const row of rows) {
      if (rendered >= MAX_RENDERED_DIFF_LINES) break;
      out.push(
        <div key={`l${i}-${rendered}`} className="grid grid-cols-[3rem_1fr_3rem_1fr]">
          <SideBySideCellView cell={row.left} highlighted={highlightedBase} />
          <SideBySideCellView cell={row.right} highlighted={highlightedTarget} />
        </div>,
      );
      rendered += 1;
    }
  }

  return (
    <>
      {out}
      {rendered >= MAX_RENDERED_DIFF_LINES ? (
        <p className="px-2 py-1 text-[11px] italic text-muted-foreground">
          Diff truncated to the first {MAX_RENDERED_DIFF_LINES} lines.
        </p>
      ) : null}
    </>
  );
}
