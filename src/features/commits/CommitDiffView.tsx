import { useMemo, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import {
  buildDiffLines,
  buildSideBySideRows,
  collapseDiff,
  eolOnlyChange,
  type DiffLine,
  type SideBySideCell,
} from "@/lib/diffView";
import { highlightLineHtml } from "@/lib/highlight";
import { readStoredString, writeStoredString } from "@/lib/storage";
import { EolOnlyNotice } from "@/components/EolOnlyNotice";
import { DiffLineText } from "@/components/DiffLineText";
import { COMMIT_DIFF_MODE_STORAGE_KEY } from "./commitSearchConstants";

const MAX_RENDERED_DIFF_LINES = 2000;

type DiffMode = "unified" | "split";

const UNAVAILABLE_MESSAGES: Record<string, string> = {
  binary: "Binary file — diff is not available.",
  tooLarge: "File is too large to diff in the app.",
  missing: "File content could not be loaded.",
};

function rowBackground(kind: DiffLine["kind"]): string {
  return kind === "add"
    ? "bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-200"
    : kind === "del"
      ? "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200"
      : "";
}

function loadMode(): DiffMode {
  return readStoredString(COMMIT_DIFF_MODE_STORAGE_KEY) === "split" ? "split" : "unified";
}

/**
 * Renders a file's diff as unified lines or side-by-side columns (a toggle, kept
 * across sessions), syntax-highlighted by `fileName`'s extension. Every
 * gap-expand button and the first line of each contiguous add/del run carries
 * `data-hunk="true"` so the panel's keyboard handler can jump between changes
 * with n/p without moving DOM focus off the selected file row (see
 * CommitFilesPanel's hunk navigation).
 */
export function CommitDiffView({
  baseContent,
  targetContent,
  baseUnavailableReason,
  targetUnavailableReason,
  fileName = "",
}: {
  baseContent: string | null;
  targetContent: string | null;
  baseUnavailableReason: string | null;
  targetUnavailableReason: string | null;
  fileName?: string;
}) {
  const [expandedGaps, setExpandedGaps] = useState<Set<number>>(() => new Set());
  const [mode, setModeState] = useState<DiffMode>(loadMode);
  function setMode(next: DiffMode) {
    setModeState(next);
    setExpandedGaps(new Set());
    writeStoredString(COMMIT_DIFF_MODE_STORAGE_KEY, next);
  }

  const baseBlocked = baseUnavailableReason != null;
  const targetBlocked = targetUnavailableReason != null;
  const fatalReason =
    baseBlocked && targetBlocked ? (targetUnavailableReason ?? baseUnavailableReason) : null;
  const baseText = baseBlocked ? "" : baseContent ?? "";
  const targetText = targetBlocked ? "" : targetContent ?? "";

  const collapsedUnified = useMemo(() => {
    if (fatalReason || mode !== "unified") return [];
    return collapseDiff(buildDiffLines(baseText, targetText), (line) => line.kind === "context");
  }, [baseText, targetText, fatalReason, mode]);
  const collapsedSplit = useMemo(() => {
    if (fatalReason || mode !== "split") return [];
    return collapseDiff(
      buildSideBySideRows(baseText, targetText),
      (row) => row.left?.kind === "context" && row.right?.kind === "context",
    );
  }, [baseText, targetText, fatalReason, mode]);

  const eolChange = useMemo(
    () => (fatalReason ? null : eolOnlyChange(baseText, targetText)),
    [baseText, targetText, fatalReason],
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

  let rendered = 0;
  let prevChanged = false;
  const out: React.ReactNode[] = [];

  function gapButton(index: number, hidden: number) {
    return (
      <button
        key={`gap${index}`}
        type="button"
        data-hunk="true"
        onClick={() => setExpandedGaps((prev) => new Set(prev).add(index))}
        className="flex w-full items-center justify-center gap-1 border-y border-border/60 bg-muted/40 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/70"
      >
        <ChevronsUpDown className="h-3 w-3" aria-hidden="true" />
        Expand {hidden} unchanged line{hidden === 1 ? "" : "s"}
      </button>
    );
  }

  if (mode === "split") {
    for (let i = 0; i < collapsedSplit.length && rendered < MAX_RENDERED_DIFF_LINES; i++) {
      const item = collapsedSplit[i];
      if (item.type === "gap" && !expandedGaps.has(i)) {
        prevChanged = false;
        out.push(gapButton(i, item.rows.length));
        continue;
      }
      const rows = item.type === "row" ? [item.row] : item.rows;
      for (const row of rows) {
        if (rendered >= MAX_RENDERED_DIFF_LINES) break;
        const changed = row.left?.kind === "del" || row.right?.kind === "add";
        const isHunkStart = changed && !prevChanged;
        prevChanged = changed;
        out.push(
          <div
            key={`r${i}-${rendered}`}
            {...(isHunkStart ? { "data-hunk": "true" } : {})}
            className="grid grid-cols-2"
          >
            <SplitCell cell={row.left} fileName={fileName} />
            <SplitCell cell={row.right} fileName={fileName} />
          </div>,
        );
        rendered += 1;
      }
    }
  } else {
    let prevKind: DiffLine["kind"] | null = null;
    for (let i = 0; i < collapsedUnified.length && rendered < MAX_RENDERED_DIFF_LINES; i++) {
      const item = collapsedUnified[i];
      if (item.type === "gap" && !expandedGaps.has(i)) {
        prevKind = "context";
        out.push(gapButton(i, item.rows.length));
        continue;
      }
      const rows = item.type === "row" ? [item.row] : item.rows;
      for (const line of rows) {
        if (rendered >= MAX_RENDERED_DIFF_LINES) break;
        const marker = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
        // The first line of a change run is a navigable hunk stop; context
        // lines reset the run so the next add/del marks a new stop.
        const isHunkStart = line.kind !== "context" && prevKind === "context";
        prevKind = line.kind;
        out.push(
          <div
            key={`l${i}-${rendered}`}
            {...(isHunkStart ? { "data-hunk": "true" } : {})}
            className={`grid grid-cols-[3rem_3rem_1fr] ${rowBackground(line.kind)}`}
          >
            <span className="select-none border-r border-border/60 pr-1 text-right text-muted-foreground">
              {line.baseLine ?? ""}
            </span>
            <span className="select-none border-r border-border/60 pr-1 text-right text-muted-foreground">
              {line.targetLine ?? ""}
            </span>
            <span className="whitespace-pre-wrap break-all pl-1">
              {marker}
              <DiffLineText
                segments={line.segments}
                text={line.text}
                kind={line.kind}
                html={highlightLineHtml(line.text, fileName)}
              />
            </span>
          </div>,
        );
        rendered += 1;
      }
    }
  }

  return (
    <div className="font-mono text-[11px] leading-4">
      <div className="flex justify-end border-b border-border/60 px-2 py-0.5">
        <div
          role="group"
          aria-label="Diff layout"
          className="flex overflow-hidden rounded border border-border font-sans text-[11px]"
        >
          {(["unified", "split"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={`px-2 py-0.5 ${mode === value ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground"}`}
            >
              {value === "unified" ? "Unified" : "Side by side"}
            </button>
          ))}
        </div>
      </div>
      {partialNote ? (
        <p className="border-b border-border bg-yellow-50 px-2 py-1 text-[11px] text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300">
          {partialNote}
        </p>
      ) : null}
      {eolChange ? <EolOnlyNotice change={eolChange} /> : null}
      {out}
      {rendered >= MAX_RENDERED_DIFF_LINES ? (
        <p className="px-2 py-1 text-[11px] italic text-muted-foreground">
          Diff truncated to the first {MAX_RENDERED_DIFF_LINES} lines.
        </p>
      ) : null}
    </div>
  );
}

function SplitCell({ cell, fileName }: { cell: SideBySideCell | null; fileName: string }) {
  if (!cell) {
    return <div className="border-r border-border/60 bg-muted/20" aria-hidden="true" />;
  }
  return (
    <div
      className={`grid min-w-0 grid-cols-[3rem_1fr] border-r border-border/60 ${rowBackground(cell.kind)}`}
    >
      <span className="select-none border-r border-border/60 pr-1 text-right text-muted-foreground">
        {cell.line}
      </span>
      <span className="whitespace-pre-wrap break-all pl-1">
        <DiffLineText
          segments={cell.segments}
          text={cell.text}
          kind={cell.kind}
          html={highlightLineHtml(cell.text, fileName)}
        />
      </span>
    </div>
  );
}
