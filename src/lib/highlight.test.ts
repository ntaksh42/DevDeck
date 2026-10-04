import { describe, expect, it } from "vitest";
import { highlightCode, splitHighlightedLines } from "./highlight";

describe("highlightCode", () => {
  it("highlights a small file by extension", () => {
    const result = highlightCode("const a = 1;", "a.ts");
    expect(result.skipped).toBe(false);
    expect(result.language).toBe("typescript");
    expect(result.html).toContain("hljs-");
  });

  it("skips auto-detection for large files of unknown type", () => {
    const content = "<b>x</b>\n".repeat(20_000);
    const result = highlightCode(content, "notes.log");
    expect(result.skipped).toBe(true);
    expect(result.language).toBeNull();
    expect(result.html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(result.html).not.toContain("hljs-");
  });

  it("still highlights mid-sized files when the extension gives the language", () => {
    const content = "const a = 1;\n".repeat(10_000);
    expect(highlightCode(content, "a.ts").skipped).toBe(false);
  });

  it("skips highlighting for very large files even with a known extension", () => {
    const content = "const a = 1;\n".repeat(30_000);
    expect(highlightCode(content, "a.ts").skipped).toBe(true);
  });
});

describe("splitHighlightedLines", () => {
  it("splits plain html on newlines", () => {
    expect(splitHighlightedLines("a\nb\n")).toEqual(["a", "b", ""]);
  });

  it("closes and reopens spans that cross a line break", () => {
    const html = '<span class="hljs-comment">/* a\nb */</span>\nc';
    expect(splitHighlightedLines(html)).toEqual([
      '<span class="hljs-comment">/* a</span>',
      '<span class="hljs-comment">b */</span>',
      "c",
    ]);
  });

  it("returns as many lines as the source content has", () => {
    const content = "/* a\nb */\nconst x = 1;\n";
    const { html } = highlightCode(content, "a.ts");
    expect(splitHighlightedLines(html)).toHaveLength(content.split("\n").length);
  });
});
