import { describe, expect, it, vi } from "vitest";
import { commentRichHtml, hydrateAuthenticatedImages } from "./workItemHtml";

// Azure DevOps substitutes attachment URLs in rendered comment HTML with this
// control character. Written via fromCharCode so the literal cannot be lost in
// transit through editors that strip control characters.
const PLACEHOLDER = String.fromCharCode(6);

const WIT_URL = "https://dev.azure.com/contoso/project/_apis/wit/attachments/abc?fileName=a.png";
const PR_URL =
  "https://dev.azure.com/contoso/project/_apis/git/repositories/repo-id/pullRequests/42/attachments/shot.png";
const BASE = "https://dev.azure.com/contoso/project/_workitems/edit/17";

describe("commentRichHtml attachment placeholders", () => {
  it("prefers the source HTML for a PR attachment behind a placeholder", () => {
    // The old check only accepted "/_apis/wit/attachments/" source URLs, so a PR
    // attachment kept the placeholder src and rendered as its alt text.
    const html = commentRichHtml(
      `<p><img src="${PLACEHOLDER}/shot.png" alt="Image"></p>`,
      `<p><img src="${PR_URL}" alt="Image"></p>`,
      new Map(),
    );

    expect(html).toContain(`src="${PR_URL}"`);
    expect(html).not.toContain(PLACEHOLDER);
  });

  it("prefers the source HTML when the placeholder src uses single quotes", () => {
    const html = commentRichHtml(
      `<p><img src='${PLACEHOLDER}/abc?fileName=a.png' alt="Image"></p>`,
      `<p><img src="${WIT_URL}" alt="Image"></p>`,
      new Map(),
    );

    expect(html).toContain(`src="${WIT_URL}"`);
  });

  it("prefers the source HTML when the placeholder replaces the whole URL", () => {
    const html = commentRichHtml(
      `<p><img src="${PLACEHOLDER}" alt="Image"></p>`,
      `<p><img src="${WIT_URL}" alt="Image"></p>`,
      new Map(),
    );

    expect(html).toContain(`src="${WIT_URL}"`);
  });

  it("keeps the rendered HTML when it carries no placeholder", () => {
    const html = commentRichHtml(
      `<p><img src="${WIT_URL}" alt="Image"><em>rendered</em></p>`,
      "<p>plain</p>",
      new Map(),
    );

    expect(html).toContain("rendered");
  });
});

describe("hydrateAuthenticatedImages", () => {
  function docWith(imgHtml: string): Document {
    return new DOMParser().parseFromString(`<html><body>${imgHtml}</body></html>`, "text/html");
  }

  function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("hydrates PR attachment images embedded in a work item comment", async () => {
    const doc = docWith(`<img src="${PR_URL}" alt="Image">`);
    const resolve = vi.fn().mockResolvedValue("data:image/png;base64,AAA");

    hydrateAuthenticatedImages(doc, BASE, resolve, () => {});
    await flush();

    expect(resolve).toHaveBeenCalledWith(PR_URL);
    expect(doc.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAA");
  });

  it("hydrates work item attachment images", async () => {
    const doc = docWith(`<img src="${WIT_URL}" alt="Image">`);
    const resolve = vi.fn().mockResolvedValue("data:image/png;base64,BBB");

    hydrateAuthenticatedImages(doc, BASE, resolve, () => {});
    await flush();

    expect(doc.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,BBB");
  });

  it("strips a leading placeholder so the path still resolves against the base URL", async () => {
    const doc = docWith(
      `<img src="${PLACEHOLDER}/project/_apis/wit/attachments/abc" alt="Image">`,
    );
    const resolve = vi.fn().mockResolvedValue("data:image/png;base64,CCC");

    hydrateAuthenticatedImages(doc, BASE, resolve, () => {});
    await flush();

    expect(resolve).toHaveBeenCalledWith("https://dev.azure.com/project/_apis/wit/attachments/abc");
    expect(doc.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,CCC");
  });

  it("shows an error instead of a broken image when the resolver yields nothing", async () => {
    const doc = docWith(`<img src="${WIT_URL}" alt="Image">`);

    hydrateAuthenticatedImages(doc, BASE, vi.fn().mockResolvedValue(null), () => {});
    await flush();

    expect(doc.querySelector("img")).toBeNull();
    expect(doc.querySelector(".azdo-image-error")).not.toBeNull();
  });

  it("shows an error when the resolver rejects", async () => {
    const doc = docWith(`<img src="${WIT_URL}" alt="Image">`);

    hydrateAuthenticatedImages(doc, BASE, vi.fn().mockRejectedValue(new Error("401")), () => {});
    await flush();

    expect(doc.querySelector("img")).toBeNull();
    expect(doc.querySelector(".azdo-image-error")).not.toBeNull();
  });

  it("leaves ordinary images untouched", async () => {
    const doc = docWith(`<img src="https://example.test/logo.png" alt="Logo">`);
    const resolve = vi.fn();

    hydrateAuthenticatedImages(doc, BASE, resolve, () => {});
    await flush();

    expect(resolve).not.toHaveBeenCalled();
    expect(doc.querySelector("img")?.getAttribute("src")).toBe("https://example.test/logo.png");
  });

  it("does not hydrate an image twice", async () => {
    const doc = docWith(`<img src="${WIT_URL}" alt="Image">`);
    const resolve = vi.fn().mockResolvedValue("data:image/png;base64,DDD");

    hydrateAuthenticatedImages(doc, BASE, resolve, () => {});
    hydrateAuthenticatedImages(doc, BASE, resolve, () => {});
    await flush();

    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
