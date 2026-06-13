import { describe, expect, it } from "vitest";
import { buildDiffLines, buildSideBySideRows } from "./diffView";

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
});
