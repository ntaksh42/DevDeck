import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MarkdownView, renderMarkdownHtml } from "./markdown";

describe("renderMarkdownHtml", () => {
  it("renders headings, lists, and code", () => {
    const html = renderMarkdownHtml("## Title\n\n- item one\n- item two\n\n`code`");
    expect(html).toContain("<h2>");
    expect(html).toContain("<li>item one</li>");
    expect(html).toContain("<code>code</code>");
  });

  it("strips script tags and event handlers", () => {
    const html = renderMarkdownHtml('hello <script>alert(1)</script> <img src=x onerror="alert(1)">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });

  it("keeps link hrefs", () => {
    const html = renderMarkdownHtml("[docs](https://example.com/docs)");
    expect(html).toContain('href="https://example.com/docs"');
  });

  it("adds rel=noopener noreferrer to target=_blank links", () => {
    const html = renderMarkdownHtml('<a href="https://example.com" target="_blank">x</a>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("does not add rel to links without target=_blank", () => {
    const html = renderMarkdownHtml("[docs](https://example.com/docs)");
    expect(html).not.toContain("rel=");
  });

  it("adds referrerpolicy=no-referrer to images", () => {
    const html = renderMarkdownHtml('![alt](https://example.com/a.png)');
    expect(html).toContain('src="https://example.com/a.png"');
    expect(html).toContain('referrerpolicy="no-referrer"');
  });

  it("keeps data: image sources", () => {
    const html = renderMarkdownHtml('<img src="data:image/png;base64,AAAA">');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
  });

  it("drops images with unsafe schemes while keeping referrerpolicy", () => {
    const html = renderMarkdownHtml('<img src="javascript:alert(1)"> <img src="ftp://example.com/a.png">');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("ftp://");
    expect(html).toContain('referrerpolicy="no-referrer"');
  });

  it("keeps unresolved @<guid> mention tokens visible as text", () => {
    // marked would treat "<guid>" as inline HTML and DOMPurify would drop it,
    // leaving a stray "@". The literal token must survive instead.
    const guid = "a1b2c3d4-e5f6-7890-abcd-ef0123456789";
    const html = renderMarkdownHtml(`hi @<${guid}> there`);
    expect(html).toContain(`@&lt;${guid}&gt;`);
    expect(html).not.toMatch(/hi @\s+there/);
  });

  it("leaves @<guid> inside code spans untouched", () => {
    const html = renderMarkdownHtml("`@<guid>`");
    expect(html).toContain("<code>@&lt;guid&gt;</code>");
  });
});

describe("MarkdownView", () => {
  it("renders markdown content into the DOM", () => {
    const { container } = render(<MarkdownView text={"**bold** text"} />);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
  });
});
