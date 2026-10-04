import { useMemo } from "react";
import { DiffLineText } from "@/components/DiffLineText";
import {
  buildDiffLines,
  buildSideBySideRows,
  collapseDiff,
  eolOnlyChange,
  type DiffLine,
  type DiffLineKind,
  type SideBySideCell,
} from "@/lib/diffView";

export type CompareDiffMode = "unified" | "split";

function rowBackground(kind: DiffLineKind): string {
  if (kind === "add") return "bg-green-100/60 dark:bg-green-900/30";
  if (kind === "del") return "bg-red-100/60 dark:bg-red-900/30";
  return "";
}

function marker(kind: DiffLineKind): string {
  if (kind === "add") return "+ ";
  if (kind === "del") return "- ";
  return "  ";
}

function Gap({ count }: { count: number }) {
  return (
    <div className="bg-muted/40 px-3 py-0.5 text-center text-[11px] text-muted-foreground">
      {count} unchanged lines hidden
    </div>
  );
}

// The diff of one file's two versions, as unified lines or side-by-side columns,
// with unchanged runs folded. Used by the Code > Compare view; unlike the PR
// diff it carries no comment threads.
export function CompareDiffBody({
  base,
  target,
  mode,
  ignoreWhitespace,
  wrap,
  baseLabel,
  targetLabel,
}: {
  base: string;
  target: string;
  mode: CompareDiffMode;
  ignoreWhitespace: boolean;
  wrap: boolean;
  baseLabel: string;
  targetLabel: string;
}) {
  const options = { ignoreWhitespace };
  const unified = useMemo(
    () => (mode === "unified" ? buildDiffLines(base, target, options) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, base, target, ignoreWhitespace],
  );
  const split = useMemo(
    () => (mode === "split" ? buildSideBySideRows(base, target, options) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, base, target, ignoreWhitespace],
  );
  const hasChanges =
    mode === "unified"
      ? unified.some((line) => line.kind !== "context")
      : split.some((row) => row.left?.kind === "del" || row.right?.kind === "add");

  if (!hasChanges) {
    const eolChange = ignoreWhitespace ? null : eolOnlyChange(base, target);
    return (
      <div className="px-3 py-3 text-sm text-muted-foreground">
        {eolChange
          ? `Only line endings differ between ${baseLabel} and ${targetLabel} (${eolChange}); the text content is identical.`
          : `No differences between ${baseLabel} and ${targetLabel}${
              ignoreWhitespace ? " (ignoring whitespace)" : ""
            }.`}
      </div>
    );
  }

  const textClass = wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre";
  if (mode === "split") {
    const items = collapseDiff(
      split,
      (row) => row.left?.kind === "context" && row.right?.kind === "context",
    );
    return (
      <div className="font-mono text-[12px] leading-5">
        {items.map((item, index) =>
          item.type === "gap" ? (
            <Gap key={`gap-${index}`} count={item.rows.length} />
          ) : (
            <div key={`row-${index}`} className="grid grid-cols-2">
              <SplitCell cell={item.row.left} textClass={textClass} />
              <SplitCell cell={item.row.right} textClass={textClass} />
            </div>
          ),
        )}
      </div>
    );
  }

  const items = collapseDiff(unified, (line: DiffLine) => line.kind === "context");
  return (
    <div className="font-mono text-[12px] leading-5">
      {items.map((item, index) =>
        item.type === "gap" ? (
          <Gap key={`gap-${index}`} count={item.rows.length} />
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
            <span className={`${textClass} px-2`}>
              {marker(item.row.kind)}
              <DiffLineText
                segments={item.row.segments}
                text={item.row.text}
                kind={item.row.kind}
              />
            </span>
          </div>
        ),
      )}
    </div>
  );
}

function SplitCell({ cell, textClass }: { cell: SideBySideCell | null; textClass: string }) {
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
      <span className={`${textClass} pl-1`}>
        <DiffLineText segments={cell.segments} text={cell.text} kind={cell.kind} />
      </span>
    </div>
  );
}
