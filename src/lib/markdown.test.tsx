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

  it("renders PR attachment image markdown with a raw space as an <img>, encoding the space", () => {
    const html = renderMarkdownHtml(
      "![image.png](https://dev.azure.com/org/proj/_apis/git/repositories/repo/pullRequests/1/attachments/Screenshot 2026-07-05 122334.png)",
    );
    expect(html).toContain(
      'src="https://dev.azure.com/org/proj/_apis/git/repositories/repo/pullRequests/1/attachments/Screenshot%202026-07-05%20122334.png"',
    );
    expect(html).toContain('alt="image.png"');
    expect(html).not.toContain("![image.png]");
  });

  it("keeps balanced parentheses in an attachment file name with raw spaces", () => {
    const html = renderMarkdownHtml(
      "![image.png](https://dev.azure.com/org/proj/_apis/git/repositories/repo/pullRequests/1/attachments/Screenshot (1).png)",
    );
    expect(html).toContain(
      'src="https://dev.azure.com/org/proj/_apis/git/repositories/repo/pullRequests/1/attachments/Screenshot%20(1).png"',
    );
    expect(html).not.toContain(".png)");
  });

  it("leaves the same image syntax inside a code span untouched", () => {
    const html = renderMarkdownHtml("`![x](https://a b.png)`");
    expect(html).toContain("<code>![x](https://a b.png)</code>");
  });

  it("does not turn a non-URL link destination with a space into an image", () => {
    const html = renderMarkdownHtml("![x](not a url)");
    expect(html).not.toContain("<img");
    expect(html).toContain("![x](not a url)");
  });

  it("still renders a titled image link without a raw space as before", () => {
    const html = renderMarkdownHtml('![alt](https://example.com/a.png "title")');
    expect(html).toContain('src="https://example.com/a.png"');
    expect(html).toContain('alt="alt"');
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

  it("hydrates absolute PR attachment image URLs", async () => {
    const attachmentUrl =
      "https://dev.azure.com/contoso/proj/_apis/git/repositories/repo-1/pullRequests/42/attachments/screen.png";
    const resolveImageSource = vi.fn().mockResolvedValue("data:image/png;base64,AAAA");
    const { container } = render(
      <MarkdownView text={`![alt](${attachmentUrl})`} resolveImageSource={resolveImageSource} />,
    );
    await waitFor(() =>
      expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA"),
    );
    expect(resolveImageSource).toHaveBeenCalledWith(attachmentUrl);
  });

  it("resolves relative PR attachment image URLs against baseUrl before hydrating", async () => {
    const relativeSrc = "/contoso/proj/_apis/git/repositories/repo-1/pullRequests/42/attachments/screen.png";
    const resolveImageSource = vi.fn().mockResolvedValue("data:image/png;base64,AAAA");
    const { container } = render(
      <MarkdownView
        text={`![alt](${relativeSrc})`}
        resolveImageSource={resolveImageSource}
        baseUrl="https://dev.azure.com/contoso/proj/_git/repo/pullrequest/42"
      />,
    );
    await waitFor(() =>
      expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA"),
    );
    expect(resolveImageSource).toHaveBeenCalledWith(`https://dev.azure.com${relativeSrc}`);
  });

  it("drops protocol-relative image sources during sanitization", () => {
    const html = renderMarkdownHtml('<img src="//evil.example/x.png">');
    expect(html).not.toContain("evil.example");
  });

  it("hydrates PR attachment image URLs that contain an encoded space", async () => {
    const attachmentUrl =
      "https://dev.azure.com/contoso/proj/_apis/git/repositories/repo-1/pullRequests/42/attachments/Screenshot 2026-07-05 122334.png";
    const resolveImageSource = vi.fn().mockResolvedValue("data:image/png;base64,AAAA");
    const { container } = render(
      <MarkdownView
        text={`![image.png](${attachmentUrl})`}
        resolveImageSource={resolveImageSource}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA"),
    );
    expect(resolveImageSource).toHaveBeenCalledWith(attachmentUrl.replace(/ /g, "%20"));
  });

  it("hydrates PR attachment file names containing raw spaces and balanced parentheses", async () => {
    const attachmentUrl =
      "https://dev.azure.com/contoso/proj/_apis/git/repositories/repo-1/pullRequests/42/attachments/Screenshot (1).png";
    const resolveImageSource = vi.fn().mockResolvedValue("data:image/png;base64,AAAA");
    const { container } = render(
      <MarkdownView
        text={`![image.png](${attachmentUrl})`}
        resolveImageSource={resolveImageSource}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA"),
    );
    expect(resolveImageSource).toHaveBeenCalledWith(attachmentUrl.replace(" ", "%20"));
  });
});
