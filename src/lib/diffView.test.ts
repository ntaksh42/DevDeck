import { describe, expect, it } from "vitest";
import { buildDiffLines } from "./diffView";

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
