import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  POST_STATE_ATTR,
  commentKey,
  handleResultLinkClick,
  prepareResultLinks,
  readResultComment,
  rememberPosted,
  type CommentPoster,
} from "./resultComment";

const PR = "https://dev.azure.com/org/proj/_git/repo/pullrequest/42";
const HREF = `${PR}?_a=files&path=%2Fa.ts&line=3`;
const COMMENT = { filePath: "/a.ts", line: 3, content: "c" };

let scopeSeq = 0;
function poster(post = vi.fn(async () => undefined)): CommentPoster & { post: typeof post } {
  // A fresh scope per test keeps the shared posted record from leaking between tests.
  scopeSeq += 1;
  return { scope: `pr-${scopeSeq}`, post };
}

function link(href: string, comment?: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.setAttribute("href", href);
  if (comment !== undefined) a.setAttribute("data-ado-comment", comment);
  document.body.appendChild(a);
  return a;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("readResultComment", () => {
  it("reads the file, line and comment of a finding link", () => {
    const a = link(`${PR}?_a=files&path=%2Fsrc%2Fa.ts&line=12&lineStartColumn=1&lineEnd=13&lineEndColumn=1`, " 境界を見落としています\n");
    expect(readResultComment(a)).toEqual({ filePath: "/src/a.ts", line: 12, content: "境界を見落としています" });
  });

  it("ignores links without a comment, a path or a line", () => {
    expect(readResultComment(link(`${PR}?_a=files&path=%2Fsrc%2Fa.ts&line=12`))).toBeNull();
    expect(readResultComment(link(`${PR}?_a=files&path=%2Fsrc%2Fa.ts`, "c"))).toBeNull();
    expect(readResultComment(link(`${PR}?_a=files&line=3`, "c"))).toBeNull();
    expect(readResultComment(link(`${PR}?_a=files&path=src&line=3`, "c"))).toBeNull();
    expect(readResultComment(link(`${PR}?_a=files&path=%2Fa&line=0`, "c"))).toBeNull();
    expect(readResultComment(link("file:///C:/a.html", "c"))).toBeNull();
  });
});

describe("handleResultLinkClick", () => {
  it("posts once, marks the link and opens it; a second click only opens", async () => {
    const a = link(HREF, "c");
    const p = poster();
    const open = vi.fn();
    await handleResultLinkClick(a, HREF, p, open);
    expect(p.post).toHaveBeenCalledWith(COMMENT);
    expect(a.getAttribute(POST_STATE_ATTR)).toBe("posted");
    expect(open).toHaveBeenCalledWith(HREF);
    await handleResultLinkClick(a, HREF, p, open);
    expect(p.post).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("does not post again after the result is rebuilt", async () => {
    const p = poster();
    await handleResultLinkClick(link(HREF, "c"), HREF, p, vi.fn());
    document.body.innerHTML = "";
    const rebuilt = link(HREF, "c");
    await handleResultLinkClick(rebuilt, HREF, p, vi.fn());
    expect(p.post).toHaveBeenCalledTimes(1);
    expect(rebuilt.getAttribute(POST_STATE_ATTR)).toBe("posted");
  });

  it("ignores clicks while posting", async () => {
    let release = () => {};
    const p = poster(vi.fn(() => new Promise<undefined>((resolve) => { release = () => resolve(undefined); })));
    const a = link(HREF, "c");
    const first = handleResultLinkClick(a, HREF, p, vi.fn());
    const open = vi.fn();
    await handleResultLinkClick(a, HREF, p, open);
    expect(open).not.toHaveBeenCalled();
    release();
    await first;
    expect(p.post).toHaveBeenCalledTimes(1);
  });

  it("shows the error without adding text, and a retry posts again", async () => {
    const p = poster(vi.fn(async () => {
      throw new Error("write disabled");
    }));
    const a = link(HREF, "c");
    const open = vi.fn();
    await handleResultLinkClick(a, HREF, p, open);
    expect(a.getAttribute(POST_STATE_ATTR)).toBe("failed");
    expect(a.getAttribute("data-ado-comment-error")).toContain("write disabled");
    expect(document.body.textContent).toBe("");
    expect(open).not.toHaveBeenCalled();
    await handleResultLinkClick(a, HREF, p, open);
    expect(p.post).toHaveBeenCalledTimes(2);
  });

  it("only opens links without a comment or without a poster", async () => {
    const open = vi.fn();
    const p = poster();
    await handleResultLinkClick(link(`${PR}?_a=files&path=%2Fa.ts`), PR, p, open);
    await handleResultLinkClick(link(HREF, "c"), HREF, undefined, open);
    expect(p.post).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe("prepareResultLinks", () => {
  it("shows the comment as the tooltip and marks posted links", () => {
    const p = poster();
    rememberPosted(commentKey(p.scope, COMMENT));
    const posted = link(HREF, "c");
    const fresh = link(`${PR}?_a=files&path=%2Fb.ts&line=5`, "d");
    prepareResultLinks(document, p);
    expect(posted.getAttribute(POST_STATE_ATTR)).toBe("posted");
    expect(fresh.hasAttribute(POST_STATE_ATTR)).toBe(false);
    expect(fresh.getAttribute("title")).toContain("d");
  });
});
