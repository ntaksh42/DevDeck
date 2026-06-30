import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
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

  it("hydrates authenticated Azure DevOps attachment images to data URLs", async () => {
    const attachmentUrl =
      "https://dev.azure.com/contoso/proj/_apis/wit/attachments/abc?fileName=a.png";
    const resolveImageSource = vi.fn().mockResolvedValue("data:image/png;base64,AAAA");
    const { container } = render(
      <MarkdownView text={`![alt](${attachmentUrl})`} resolveImageSource={resolveImageSource} />,
    );
    await waitFor(() =>
      expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA"),
    );
    expect(resolveImageSource).toHaveBeenCalledWith(attachmentUrl);
  });

  it("does not hydrate non-attachment image URLs", async () => {
    const resolveImageSource = vi.fn().mockResolvedValue("data:image/png;base64,AAAA");
    render(
      <MarkdownView
        text={"![alt](https://example.com/a.png)"}
        resolveImageSource={resolveImageSource}
      />,
    );
    await Promise.resolve();
    expect(resolveImageSource).not.toHaveBeenCalled();
  });
});
