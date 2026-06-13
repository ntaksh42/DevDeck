import { diffLines } from "diff";

export type DiffLineKind = "context" | "add" | "del";

export type DiffLine = {
  kind: DiffLineKind;
  baseLine: number | null;
  targetLine: number | null;
  text: string;
};

function splitLines(value: string): string[] {
  if (value === "") return [];
  const lines = value.split("\n");
  // A trailing newline yields an empty element that is not a real line.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export type SideBySideCell = {
  line: number;
  text: string;
  kind: DiffLineKind;
};

export type SideBySideRow = {
  left: SideBySideCell | null;
  right: SideBySideCell | null;
};

/**
 * Builds split-view rows: consecutive removed/added runs are paired index-wise
 * (GitHub-style), context lines occupy both sides.
 */
export function buildSideBySideRows(base: string, target: string): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let baseLine = 1;
  let targetLine = 1;
  let pendingLeft: SideBySideCell[] = [];

  function flushPending(rightCells: SideBySideCell[]) {
    const count = Math.max(pendingLeft.length, rightCells.length);
    for (let i = 0; i < count; i++) {
      rows.push({ left: pendingLeft[i] ?? null, right: rightCells[i] ?? null });
    }
    pendingLeft = [];
  }

  for (const part of diffLines(base, target)) {
    const texts = splitLines(part.value);
    if (part.removed) {
      // Hold removed lines until we know whether an added run follows.
      flushPending([]);
      pendingLeft = texts.map((text) => ({ line: baseLine++, text, kind: "del" as const }));
    } else if (part.added) {
      flushPending(texts.map((text) => ({ line: targetLine++, text, kind: "add" as const })));
    } else {
      flushPending([]);
      for (const text of texts) {
        rows.push({
          left: { line: baseLine++, text, kind: "context" },
          right: { line: targetLine++, text, kind: "context" },
        });
      }
    }
  }
  flushPending([]);
  return rows;
}

export function buildDiffLines(base: string, target: string): DiffLine[] {
  const result: DiffLine[] = [];
  let baseLine = 1;
  let targetLine = 1;
  for (const part of diffLines(base, target)) {
    const kind: DiffLineKind = part.added ? "add" : part.removed ? "del" : "context";
    for (const text of splitLines(part.value)) {
      result.push({
        kind,
        baseLine: kind === "add" ? null : baseLine++,
        targetLine: kind === "del" ? null : targetLine++,
        text,
      });
    }
  }
  return result;
}
