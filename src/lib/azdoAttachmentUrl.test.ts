import { describe, expect, it } from "vitest";
import { applyHydratedImageSource, toAzdoAttachmentUrl } from "./azdoAttachmentUrl";

const BASE = "https://dev.azure.com/contoso/project/_git/repo/pullrequest/42";

describe("toAzdoAttachmentUrl", () => {
  it("recognizes work item attachment URLs", () => {
    const url =
      "https://dev.azure.com/contoso/project/_apis/wit/attachments/abc?fileName=a.png";
    expect(toAzdoAttachmentUrl(url, BASE)).toBe(url);
  });

  it("recognizes PR-scoped attachment URLs", () => {
    const url =
      "https://dev.azure.com/contoso/project/_apis/git/repositories/repo-id/pullRequests/42/attachments/shot.png";
    expect(toAzdoAttachmentUrl(url, BASE)).toBe(url);
  });

  it("matches PR attachment URLs case-insensitively", () => {
    const url =
      "https://dev.azure.com/contoso/project/_APIS/Git/Repositories/repo-id/PullRequests/42/Attachments/shot.png";
    expect(toAzdoAttachmentUrl(url, BASE)).toBe(url);
  });

  // The backend only fetches the two shapes above (see is_allowed_attachment_path
  // in crates/azdo-client). Matching anything broader here would only produce IPC
  // calls that are rejected, turning an unfetchable image into a visible error.
  it("ignores attachment-looking paths the backend will not fetch", () => {
    expect(
      toAzdoAttachmentUrl(
        "https://dev.azure.com/contoso/project/_apis/git/repositories/repo-id/attachments/shot.png",
        BASE,
      ),
    ).toBeNull();
    expect(
      toAzdoAttachmentUrl(
        "https://dev.azure.com/contoso/project/_apis/wit/workitems/17/attachments/shot.png",
        BASE,
      ),
    ).toBeNull();
  });

  it("resolves relative attachment paths against the base URL", () => {
    expect(
      toAzdoAttachmentUrl("/project/_apis/wit/attachments/abc?fileName=a.png", BASE),
    ).toBe("https://dev.azure.com/project/_apis/wit/attachments/abc?fileName=a.png");
  });

  it("ignores ordinary images that need no authentication", () => {
    expect(toAzdoAttachmentUrl("https://example.test/logo.png", BASE)).toBeNull();
    expect(toAzdoAttachmentUrl("https://dev.azure.com/contoso/_git/repo/raw/a.png", BASE)).toBeNull();
  });

  it("ignores non-http schemes", () => {
    expect(toAzdoAttachmentUrl("data:image/png;base64,AAAA", BASE)).toBeNull();
    expect(toAzdoAttachmentUrl("blob:https://app.test/abc", BASE)).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(toAzdoAttachmentUrl("", null)).toBeNull();
  });
});

describe("applyHydratedImageSource", () => {
  function imageWith(attributes: string): HTMLImageElement {
    const doc = new DOMParser().parseFromString(
      `<html><body><img ${attributes}></body></html>`,
      "text/html",
    );
    const image = doc.querySelector("img");
    if (!image) throw new Error("expected an img");
    return image;
  }

  // srcset outranks src when the browser chooses a candidate. Leaving it in
  // place kept the authenticated URL in play, so the image 401'd and rendered
  // its alt text even though src had been hydrated.
  it("removes srcset and sizes so the data URL is the only candidate", () => {
    const attachment =
      "https://dev.azure.com/contoso/project/_apis/wit/attachments/abc?fileName=a.png";
    const image = imageWith(`src="${attachment}" srcset="${attachment} 2x" sizes="100vw"`);

    applyHydratedImageSource(image, "data:image/png;base64,AAAA");

    expect(image.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(image.getAttribute("srcset")).toBeNull();
    expect(image.getAttribute("sizes")).toBeNull();
  });

  it("leaves an image without responsive attributes untouched apart from src", () => {
    const image = imageWith('src="https://dev.azure.com/a.png" alt="Image"');

    applyHydratedImageSource(image, "data:image/png;base64,BBBB");

    expect(image.getAttribute("src")).toBe("data:image/png;base64,BBBB");
    expect(image.getAttribute("alt")).toBe("Image");
  });
});
