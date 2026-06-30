import { useMemo } from "react";
import {
  buildDiffLines,
  buildSideBySideRows,
  collapseDiff,
  type SideBySideCell,
} from "@/lib/diffView";
import { DiffLineText } from "@/components/DiffLineText";

export type DiffViewMode = "unified" | "split";

const UNAVAILABLE_MESSAGES: Record<string, string> = {
  binary: "Binary file — diff is not available.",
  tooLarge: "File is too large to diff in the app.",
  missing: "File content could not be loaded.",
};

/**
 * Comment-free diff renderer shared by surfaces that don't need PR review
 * affordances (line comments, "whole file"). Supports a unified/split toggle,
 * an ignore-whitespace option, and a word-wrap toggle for long lines. The PR
 * review diff (`PrFileDiffView.tsx`) stays its own implementation since it is
 * tightly coupled to comment threads; this component is for everything else
 * (currently the Code > Compare tab).
 */
export function DiffView({
  baseContent,
  targetContent,
  baseUnavailableReason,
  targetUnavailableReason,
  viewMode,
  ignoreWhitespace,
  wordWrap,
  emptyMessage = "No differences.",
}: {
  baseContent: string | null;
  targetContent: string | null;
  baseUnavailableReason: string | null;
  targetUnavailableReason: string | null;
  viewMode: DiffViewMode;
  ignoreWhitespace: boolean;
  wordWrap: boolean;
  emptyMessage?: string;
}) {
  const baseBlocked = baseUnavailableReason != null;
  const targetBlocked = targetUnavailableReason != null;
  // Only give up when neither side can be shown. A single blocked side still
  // renders (e.g. base too large → show the new file as additions).
  const fatalReason =
    baseBlocked && targetBlocked ? (targetUnavailableReason ?? baseUnavailableReason) : null;
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
    () =>
      fatalReason || viewMode !== "unified"
        ? []
        : buildDiffLines(baseText, targetText, { ignoreWhitespace }),
    [baseText, targetText, fatalReason, viewMode, ignoreWhitespace],
  );
  const split = useMemo(
    () =>
      fatalReason || viewMode !== "split"
        ? []
        : buildSideBySideRows(baseText, targetText, { ignoreWhitespace }),
    [baseText, targetText, fatalReason, viewMode, ignoreWhitespace],
  );

  const collapsedUnified = useMemo(
    () => collapseDiff(unified, (line) => line.kind === "context"),
    [unified],
  );
  const collapsedSplit = useMemo(
    () =>
      collapseDiff(
        split,
        (row) => (row.left?.kind ?? "context") === "context" && (row.right?.kind ?? "context") === "context",
      ),
    [split],
  );

  const hasChanges =
    viewMode === "unified"
      ? unified.some((line) => line.kind !== "context")
      : split.some((row) => row.left?.kind !== "context" || row.right?.kind !== "context");

  if (fatalReason) {
    return (
      <div className="px-3 py-3 text-sm text-muted-foreground">
        {UNAVAILABLE_MESSAGES[fatalReason] ?? "Diff is not available."}
      </div>
    );
  }

  if (!hasChanges) {
    return <div className="px-3 py-3 text-sm text-muted-foreground">{emptyMessage}</div>;
  }

  const wrapClass = wordWrap ? "whitespace-pre-wrap break-all" : "whitespace-pre";
  const note = partialNote ? (
    <p className="border-b border-border bg-yellow-50 px-2 py-1 text-[11px] text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300">
      {partialNote}
    </p>
  ) : null;

  if (viewMode === "split") {
    return (
      <div className="font-mono text-[12px] leading-5">
        {note}
        {collapsedSplit.map((item, index) =>
          item.type === "gap" ? (
            <GapBar key={`gap-${index}`} count={item.rows.length} />
          ) : (
            <div key={`row-${index}`} className="grid grid-cols-2">
              <SplitCell cell={item.row.left} wrapClass={wrapClass} />
              <SplitCell cell={item.row.right} wrapClass={wrapClass} />
            </div>
          ),
        )}
      </div>
    );
  }

  return (
    <div className="font-mono text-[12px] leading-5">
      {note}
      {collapsedUnified.map((item, index) =>
        item.type === "gap" ? (
          <GapBar key={`gap-${index}`} count={item.rows.length} />
        ) : (
          <div
            key={`row-${index}`}
            className={`grid grid-cols-[3rem_3rem_1fr] ${rowBackground(item.row.kind)}`}
          >
            <span className="select-none px-1 text-right text-muted-foreground">
              {item.row.baseLine ?? ""}
            </span>
            <span className="select-none px-1 text-right text-muted-foreground">
              {item.row.targetLine ?? ""}
            </span>
            <span className={`px-2 ${wrapClass}`}>
              {marker(item.row.kind)}
              <DiffLineText segments={item.row.segments} text={item.row.text} kind={item.row.kind} />
            </span>
          </div>
        ),
      )}
    </div>
  );
}

function GapBar({ count }: { count: number }) {
  return (
    <div className="bg-muted/40 px-3 py-0.5 text-center text-[11px] text-muted-foreground">
      {count} unchanged line{count === 1 ? "" : "s"} hidden
    </div>
  );
}

function SplitCell({ cell, wrapClass }: { cell: SideBySideCell | null; wrapClass: string }) {
  if (!cell) {
    return <div className="border-r border-border/60 bg-muted/20" aria-hidden="true" />;
  }
  return (
    <div
      className={`grid min-w-0 grid-cols-[3rem_1fr] border-r border-border/60 ${rowBackground(cell.kind)}`}
    >
      <span className="select-none px-1 text-right text-muted-foreground">{cell.line}</span>
      <span className={`px-2 ${wrapClass}`}>
        <DiffLineText segments={cell.segments} text={cell.text} kind={cell.kind} />
      </span>
    </div>
  );
}

function rowBackground(kind: "context" | "add" | "del"): string {
  if (kind === "add") return "bg-green-100/60 dark:bg-green-900/30";
  if (kind === "del") return "bg-red-100/60 dark:bg-red-900/30";
  return "";
}

function marker(kind: "context" | "add" | "del"): string {
  if (kind === "add") return "+ ";
  if (kind === "del") return "- ";
  return "  ";
}
