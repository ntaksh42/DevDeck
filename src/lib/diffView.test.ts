import { describe, expect, it } from "vitest";
import { buildDiffLines, buildSideBySideRows, collapseDiff } from "./diffView";

describe("buildDiffLines", () => {
  it("marks added and removed lines with line numbers", () => {
    const base = "a\nb\nc\n";
    const target = "a\nB\nc\n";
    const lines = buildDiffLines(base, target);
    expect(lines).toEqual([
      { kind: "context", baseLine: 1, targetLine: 1, text: "a" },
      { kind: "del", baseLine: 2, targetLine: null, text: "b" },
      { kind: "add", baseLine: null, targetLine: 2, text: "B" },
      { kind: "context", baseLine: 3, targetLine: 3, text: "c" },
    ]);
  });

  it("handles file addition (empty base)", () => {
    const lines = buildDiffLines("", "x\ny\n");
    expect(lines).toEqual([
      { kind: "add", baseLine: null, targetLine: 1, text: "x" },
      { kind: "add", baseLine: null, targetLine: 2, text: "y" },
    ]);
  });

  it("handles file deletion (empty target)", () => {
    const lines = buildDiffLines("x\n", "");
    expect(lines).toEqual([{ kind: "del", baseLine: 1, targetLine: null, text: "x" }]);
  });

  it("treats a pure CRLF/LF newline mismatch as unchanged", () => {
    const base = "a\r\nb\r\nc\r\n";
    const target = "a\nb\nc\n";
    const lines = buildDiffLines(base, target);
    expect(lines).toEqual([
      { kind: "context", baseLine: 1, targetLine: 1, text: "a" },
      { kind: "context", baseLine: 2, targetLine: 2, text: "b" },
      { kind: "context", baseLine: 3, targetLine: 3, text: "c" },
    ]);
  });

  it("treats leading/trailing whitespace changes as unchanged when ignoreWhitespace is set", () => {
    const base = "a\n  b\nc\n";
    const target = "a\nb  \nc\n";
    const lines = buildDiffLines(base, target, { ignoreWhitespace: true });
    expect(lines.every((line) => line.kind === "context")).toBe(true);
  });

  it("still reports the whitespace change when ignoreWhitespace is not set", () => {
    const base = "a\n  b\nc\n";
    const target = "a\nb  \nc\n";
    const lines = buildDiffLines(base, target);
    expect(lines.some((line) => line.kind !== "context")).toBe(true);
  });
});

describe("buildSideBySideRows", () => {
  it("pairs removed and added lines in the same row", () => {
    const rows = buildSideBySideRows("a\nb\nc\n", "a\nB\nc\n");
    expect(rows).toEqual([
      {
        left: { line: 1, text: "a", kind: "context" },
        right: { line: 1, text: "a", kind: "context" },
      },
      {
        left: { line: 2, text: "b", kind: "del" },
        right: { line: 2, text: "B", kind: "add" },
      },
      {
        left: { line: 3, text: "c", kind: "context" },
        right: { line: 3, text: "c", kind: "context" },
      },
    ]);
  });

  it("leaves the left side empty for pure additions", () => {
    const rows = buildSideBySideRows("a\n", "a\nx\n");
    expect(rows).toEqual([
      {
        left: { line: 1, text: "a", kind: "context" },
        right: { line: 1, text: "a", kind: "context" },
      },
      { left: null, right: { line: 2, text: "x", kind: "add" } },
    ]);
  });

  it("leaves the right side empty for pure deletions", () => {
    const rows = buildSideBySideRows("a\nx\n", "a\n");
    expect(rows).toEqual([
      {
        left: { line: 1, text: "a", kind: "context" },
        right: { line: 1, text: "a", kind: "context" },
      },
      { left: { line: 2, text: "x", kind: "del" }, right: null },
    ]);
  });

  it("does not mark rows changed on a pure CRLF/LF newline mismatch", () => {
    const rows = buildSideBySideRows("a\r\nb\r\n", "a\nb\n");
    expect(rows).toEqual([
      {
        left: { line: 1, text: "a", kind: "context" },
        right: { line: 1, text: "a", kind: "context" },
      },
      {
        left: { line: 2, text: "b", kind: "context" },
        right: { line: 2, text: "b", kind: "context" },
      },
    ]);
  });
});

describe("word-level segments", () => {
  it("highlights only the changed words of a partially modified line", () => {
    const lines = buildDiffLines("foo bar baz\n", "foo qux baz\n");
    const del = lines.find((line) => line.kind === "del");
    const add = lines.find((line) => line.kind === "add");
    expect(del?.segments).toEqual([
      { text: "foo ", highlight: false },
      { text: "bar", highlight: true },
      { text: " baz", highlight: false },
    ]);
    expect(add?.segments).toEqual([
      { text: "foo ", highlight: false },
      { text: "qux", highlight: true },
      { text: " baz", highlight: false },
    ]);
  });

  it("omits segments when the whole line changed", () => {
    const lines = buildDiffLines("b\n", "B\n");
    expect(lines.every((line) => line.segments === undefined)).toBe(true);
  });

  it("attaches paired segments in split view too", () => {
    const rows = buildSideBySideRows("foo bar\n", "foo qux\n");
    const row = rows.find((candidate) => candidate.left?.kind === "del");
    expect(row?.left?.segments).toEqual([
      { text: "foo ", highlight: false },
      { text: "bar", highlight: true },
    ]);
    expect(row?.right?.segments).toEqual([
      { text: "foo ", highlight: false },
      { text: "qux", highlight: true },
    ]);
  });
});

describe("collapseDiff", () => {
  const isContext = (line: { kind: string }) => line.kind === "context";

  it("folds a long unchanged run between changes into a gap", () => {
    const base = `${Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n")}\n`;
    const target = base.replace("line0", "CHANGED0").replace("line19", "CHANGED19");
    const items = collapseDiff(buildDiffLines(base, target), isContext);
    const gaps = items.filter((item) => item.type === "gap");
    expect(gaps).toHaveLength(1);
    // Every row stays reachable: visible rows + hidden gap rows == full diff.
    const visible = items.filter((item) => item.type === "row").length;
    const hidden = gaps.reduce(
      (sum, gap) => sum + (gap.type === "gap" ? gap.rows.length : 0),
      0,
    );
    expect(visible + hidden).toBe(buildDiffLines(base, target).length);
  });

  it("keeps short unchanged runs fully visible", () => {
    const items = collapseDiff(buildDiffLines("a\nb\nc\n", "A\nb\nc\n"), isContext);
    expect(items.every((item) => item.type === "row")).toBe(true);
  });

  it("never hides non-collapsible (changed) rows", () => {
    const base = `${Array.from({ length: 30 }, (_, i) => `line${i}`).join("\n")}\n`;
    const target = base.replace("line15", "CHANGED15");
    const items = collapseDiff(buildDiffLines(base, target), isContext);
    for (const item of items) {
      if (item.type === "gap") {
        expect(item.rows.every(isContext)).toBe(true);
      }
    }
  });
});
