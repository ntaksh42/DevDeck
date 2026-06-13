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
