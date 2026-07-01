import { useMemo, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { buildDiffLines, collapseDiff, type DiffLine } from "@/lib/diffView";
import { DiffLineText } from "@/components/DiffLineText";

const MAX_RENDERED_DIFF_LINES = 2000;

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

/**
 * Renders a file's diff. Every gap-expand button and the first line of each
 * contiguous add/del run carries `data-hunk="true"` so the panel's keyboard
 * handler can jump between changes with n/p without moving DOM focus off the
 * selected file row (see CommitFilesPanel's hunk navigation).
 */
export function CommitDiffView({
  baseContent,
  targetContent,
  baseUnavailableReason,
  targetUnavailableReason,
}: {
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

  const collapsed = useMemo(() => {
    if (fatalReason) return [];
    const lines = buildDiffLines(baseText, targetText);
    return collapseDiff(lines, (line) => line.kind === "context");
  }, [baseText, targetText, fatalReason]);

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
  let prevKind: DiffLine["kind"] | null = null;
  const out: React.ReactNode[] = [];
  for (let i = 0; i < collapsed.length && rendered < MAX_RENDERED_DIFF_LINES; i++) {
    const item = collapsed[i];
    if (item.type === "gap" && !expandedGaps.has(i)) {
      prevKind = "context";
      out.push(
        <button
          key={`gap${i}`}
          type="button"
          data-hunk="true"
          onClick={() => setExpandedGaps((prev) => new Set(prev).add(i))}
          className="flex w-full items-center justify-center gap-1 border-y border-border/60 bg-muted/40 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/70"
        >
          <ChevronsUpDown className="h-3 w-3" aria-hidden="true" />
          Expand {item.rows.length} unchanged line{item.rows.length === 1 ? "" : "s"}
        </button>,
      );
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
          <span className="select-none border-r border-border/60 pr-1 text-right text-muted-foreground/70">
            {line.baseLine ?? ""}
          </span>
          <span className="select-none border-r border-border/60 pr-1 text-right text-muted-foreground/70">
            {line.targetLine ?? ""}
          </span>
          <span className="whitespace-pre-wrap break-all pl-1">
            {marker}
            <DiffLineText segments={line.segments} text={line.text} kind={line.kind} />
          </span>
        </div>,
      );
      rendered += 1;
    }
  }

  return (
    <div className="font-mono text-[11px] leading-4">
      {partialNote ? (
        <p className="border-b border-border bg-yellow-50 px-2 py-1 text-[11px] text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300">
          {partialNote}
        </p>
      ) : null}
      {out}
      {rendered >= MAX_RENDERED_DIFF_LINES ? (
        <p className="px-2 py-1 text-[11px] italic text-muted-foreground">
          Diff truncated to the first {MAX_RENDERED_DIFF_LINES} lines.
        </p>
      ) : null}
    </div>
  );
}
