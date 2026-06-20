import { describe, expect, it } from "vitest";
import {
  buildRichHtmlDocument,
  commentAuthorInitials,
  commentRichHtml,
  richFieldHtml,
} from "./workItemHtml";

function bodyOf(doc: string): string {
  return doc.slice(doc.indexOf("<body>") + "<body>".length, doc.indexOf("</body>"));
}

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

describe("buildRichHtmlDocument sanitization", () => {
  it("removes script tags from the rendered body", () => {
    const body = bodyOf(buildRichHtmlDocument('<p>Hi</p><script>alert(1)</script>'));
    expect(body).toContain("<p>Hi</p>");
    expect(body).not.toContain("<script");
    expect(body).not.toContain("alert(1)");
  });

  it("removes meta refresh so redirects cannot run", () => {
    const body = bodyOf(
      buildRichHtmlDocument('<meta http-equiv="refresh" content="0;url=https://evil.test"><p>Body</p>'),
    );
    expect(body).not.toContain("<meta");
    expect(body).not.toContain("refresh");
  });

  it("strips inline event handlers", () => {
    const body = bodyOf(buildRichHtmlDocument('<img src="https://x.test/a.png" onerror="alert(1)">'));
    expect(body).not.toContain("onerror");
  });

  it("drops javascript: URLs from links", () => {
    const body = bodyOf(buildRichHtmlDocument('<a href="javascript:alert(1)">click</a>'));
    expect(body).not.toContain("javascript:");
  });

  it("keeps links, mentions, and attachment images", () => {
    const body = bodyOf(
      buildRichHtmlDocument(
        '<p><span class="azdo-mention">@Alice</span> see <a href="https://dev.azure.com/contoso">project</a></p>' +
          '<img src="https://dev.azure.com/contoso/_apis/wit/attachments/x?fileName=a.png">',
      ),
    );
    expect(body).toContain('class="azdo-mention"');
    expect(body).toContain('href="https://dev.azure.com/contoso"');
    expect(body).toContain('src="https://dev.azure.com/contoso/_apis/wit/attachments/x?fileName=a.png"');
  });

  it("adds a no-referrer policy to images to limit tracking", () => {
    const body = bodyOf(buildRichHtmlDocument('<img src="https://tracker.test/p.gif">'));
    expect(body).toContain('referrerpolicy="no-referrer"');
  });
});
