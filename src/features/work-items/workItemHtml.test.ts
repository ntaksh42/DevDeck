import { describe, expect, it } from "vitest";
import { commentAuthorInitials, commentRichHtml, richFieldHtml } from "./workItemHtml";

describe("commentAuthorInitials", () => {
  it("uses the first letter of the first two name parts", () => {
    expect(commentAuthorInitials("Alice Walker")).toBe("AW");
  });

  it("uses the first two letters of a single-word name", () => {
    expect(commentAuthorInitials("alice")).toBe("AL");
  });

  it("falls back to a question mark for empty input", () => {
    expect(commentAuthorInitials("  ")).toBe("?");
    expect(commentAuthorInitials(null)).toBe("?");
  });
});

describe("richFieldHtml", () => {
  it("passes through existing HTML markup", () => {
    expect(richFieldHtml("<p>Hello</p>")).toBe("<p>Hello</p>");
  });

  it("renders markdown-ish plain text into HTML blocks", () => {
    const html = richFieldHtml("- one\n- two");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("returns null for empty input", () => {
    expect(richFieldHtml("   ")).toBeNull();
    expect(richFieldHtml(null)).toBeNull();
  });
});

describe("commentRichHtml", () => {
  it("substitutes mention tokens with styled spans", () => {
    const names = new Map([["user-guid", "Alice"]]);
    const html = commentRichHtml("<p>Hi @&lt;user-guid&gt;</p>", null, names);
    expect(html).toContain('<span class="azdo-mention">@Alice</span>');
  });

  it("leaves unknown mention tokens untouched", () => {
    const html = commentRichHtml("<p>Hi @&lt;unknown&gt;</p>", null, new Map());
    expect(html).toContain("@&lt;unknown&gt;");
  });

  it("falls back to plain text and finally to a placeholder", () => {
    expect(commentRichHtml(null, "just text", new Map())).toContain("just text");
    expect(commentRichHtml(null, null, new Map())).toBe("No text");
  });
});
