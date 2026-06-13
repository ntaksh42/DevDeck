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
});

describe("MarkdownView", () => {
  it("renders markdown content into the DOM", () => {
    const { container } = render(<MarkdownView text={"**bold** text"} />);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
  });
});
