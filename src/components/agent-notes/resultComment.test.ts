import { beforeEach, describe, expect, it, vi } from "vitest";

const openExternalUrl = vi.fn(async (_url: string) => undefined);
vi.mock("@/lib/openExternal", () => ({ openExternalUrl: (url: string) => openExternalUrl(url) }));

import { POST_STATE_ATTR, postFromLink, readResultComment } from "./resultComment";

const PR = "https://dev.azure.com/org/proj/_git/repo/pullrequest/42";

function link(href: string, comment?: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.setAttribute("href", href);
  if (comment !== undefined) a.setAttribute("data-ado-comment", comment);
  document.body.appendChild(a);
  return a;
}

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

describe("postFromLink", () => {
  beforeEach(() => {
    openExternalUrl.mockClear();
    document.body.innerHTML = "";
  });

  it("posts, marks the link as posted and opens it", async () => {
    const a = link(`${PR}?_a=files&path=%2Fa.ts&line=3`, "c");
    const post = vi.fn(async () => undefined);
    await postFromLink(a, { filePath: "/a.ts", line: 3, content: "c" }, post, a.href);
    expect(post).toHaveBeenCalledWith({ filePath: "/a.ts", line: 3, content: "c" });
    expect(a.getAttribute(POST_STATE_ATTR)).toBe("posted");
    expect(a.nextElementSibling?.textContent).toBe("投稿済み");
    expect(openExternalUrl).toHaveBeenCalledWith(a.href);
  });

  it("shows the error and allows a retry without stacking messages", async () => {
    const a = link(`${PR}?_a=files&path=%2Fa.ts&line=3`, "c");
    const fail = vi.fn(async () => {
      throw new Error("write disabled");
    });
    await postFromLink(a, { filePath: "/a.ts", line: 3, content: "c" }, fail, a.href);
    expect(a.hasAttribute(POST_STATE_ATTR)).toBe(false);
    expect(a.nextElementSibling?.textContent).toContain("投稿できません");
    expect(openExternalUrl).not.toHaveBeenCalled();
    await postFromLink(a, { filePath: "/a.ts", line: 3, content: "c" }, fail, a.href);
    expect(document.querySelectorAll("[data-ado-comment-status]")).toHaveLength(1);
  });
});
