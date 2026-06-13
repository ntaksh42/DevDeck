import { diffLines, diffWordsWithSpace } from "diff";

export type DiffLineKind = "context" | "add" | "del";

/** A span within a modified line; `highlight` marks the part that changed. */
export type InlineSegment = { text: string; highlight: boolean };

export type DiffLine = {
  kind: DiffLineKind;
  baseLine: number | null;
  targetLine: number | null;
  text: string;
  /** Word-level spans, present only for partially changed lines. */
  segments?: InlineSegment[];
};

function splitLines(value: string): string[] {
  if (value === "") return [];
  const lines = value.split("\n");
  // A trailing newline yields an empty element that is not a real line.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Word-level diff between a removed line and the added line that replaced it.
 * Returns `null` when the whole line changed (no shared text) — the row
 * background already conveys that, so there is nothing useful to highlight.
 */
function pairSegments(
  delText: string,
  addText: string,
): { left: InlineSegment[]; right: InlineSegment[] } | null {
  const left: InlineSegment[] = [];
  const right: InlineSegment[] = [];
  let hasCommon = false;
  let hasChange = false;
  for (const part of diffWordsWithSpace(delText, addText)) {
    if (part.added) {
      hasChange = true;
      right.push({ text: part.value, highlight: true });
    } else if (part.removed) {
      hasChange = true;
      left.push({ text: part.value, highlight: true });
    } else {
      hasCommon = true;
      left.push({ text: part.value, highlight: false });
      right.push({ text: part.value, highlight: false });
    }
  }
  if (!hasCommon || !hasChange) return null;
  return { left, right };
}

export type SideBySideCell = {
  line: number;
  text: string;
  kind: DiffLineKind;
  /** Word-level spans, present only for partially changed lines. */
  segments?: InlineSegment[];
};

export type SideBySideRow = {
  left: SideBySideCell | null;
  right: SideBySideCell | null;
};

/**
 * Builds split-view rows: consecutive removed/added runs are paired index-wise
 * (GitHub-style), context lines occupy both sides. Paired rows additionally get
 * word-level `segments` when only part of the line changed.
 */
export function buildSideBySideRows(base: string, target: string): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let baseLine = 1;
  let targetLine = 1;
  let pendingLeft: SideBySideCell[] = [];

  function flushPending(rightCells: SideBySideCell[]) {
    const count = Math.max(pendingLeft.length, rightCells.length);
    for (let i = 0; i < count; i++) {
      const left = pendingLeft[i] ?? null;
      const right = rightCells[i] ?? null;
      if (left && right) {
        const segments = pairSegments(left.text, right.text);
        if (segments) {
          left.segments = segments.left;
          right.segments = segments.right;
        }
      }
      rows.push({ left, right });
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
  const parts = diffLines(base, target);
  const result: DiffLine[] = [];
  let baseLine = 1;
  let targetLine = 1;
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    if (part.removed) {
      const delTexts = splitLines(part.value);
      const next = parts[p + 1];
      const addTexts = next?.added ? splitLines(next.value) : null;
      // Pair each removed line with the added line at the same offset so a
      // modification can carry word-level highlights.
      const pairCount = addTexts ? Math.min(delTexts.length, addTexts.length) : 0;
      const pairs = Array.from({ length: pairCount }, (_, i) =>
        pairSegments(delTexts[i], (addTexts as string[])[i]),
      );
      delTexts.forEach((text, i) => {
        result.push({
          kind: "del",
          baseLine: baseLine++,
          targetLine: null,
          text,
          ...(pairs[i] ? { segments: pairs[i]!.left } : {}),
        });
      });
      if (addTexts) {
        addTexts.forEach((text, i) => {
          result.push({
            kind: "add",
            baseLine: null,
            targetLine: targetLine++,
            text,
            ...(pairs[i] ? { segments: pairs[i]!.right } : {}),
          });
        });
        p++; // The added part was consumed alongside the removed run.
      }
    } else if (part.added) {
      for (const text of splitLines(part.value)) {
        result.push({ kind: "add", baseLine: null, targetLine: targetLine++, text });
      }
    } else {
      for (const text of splitLines(part.value)) {
        result.push({ kind: "context", baseLine: baseLine++, targetLine: targetLine++, text });
      }
    }
  }
  return result;
}

/** A run of rendered rows, or a collapsed gap of hidden unchanged rows. */
export type CollapsedItem<T> =
  | { type: "row"; row: T }
  | { type: "gap"; rows: T[] };

/**
 * Folds long runs of collapsible (unchanged) rows into gaps, keeping `context`
 * rows visible on each side of every change. A run is only collapsed when it
 * would hide at least `minHidden` rows, so small gaps stay fully shown.
 */
export function collapseDiff<T>(
  rows: T[],
  collapsible: (row: T) => boolean,
  context = 3,
  minHidden = 4,
): CollapsedItem<T>[] {
  const items: CollapsedItem<T>[] = [];
  let i = 0;
  while (i < rows.length) {
    if (!collapsible(rows[i])) {
      items.push({ type: "row", row: rows[i] });
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && collapsible(rows[j])) j++;
    const run = rows.slice(i, j);
    // No surrounding change means nothing to anchor context to at that edge.
    const head = i === 0 ? 0 : context;
    const tail = j === rows.length ? 0 : context;
    const hidden = run.length - head - tail;
    if (hidden >= minHidden) {
      for (let k = 0; k < head; k++) items.push({ type: "row", row: run[k] });
      items.push({ type: "gap", rows: run.slice(head, run.length - tail) });
      for (let k = run.length - tail; k < run.length; k++) {
        items.push({ type: "row", row: run[k] });
      }
    } else {
      for (const row of run) items.push({ type: "row", row });
    }
    i = j;
  }
  return items;
}
