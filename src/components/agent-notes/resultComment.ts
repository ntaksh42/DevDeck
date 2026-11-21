// A finding link in a PR review result can carry the comment to post on that
// line: `<a href="{PR}?_a=files&path=/src/x.ts&line=42…" data-ado-comment="…">`.
// Clicking it in DevDeck posts the comment as a new thread on the line (see
// ResultFrame). Links without the attribute, a path or a line stay plain links.

import { commandErrorMessage } from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";

export type ResultComment = { filePath: string; line: number; content: string };

export const RESULT_COMMENT_ATTR = "data-ado-comment";

export function readResultComment(link: Element): ResultComment | null {
  const content = link.getAttribute(RESULT_COMMENT_ATTR)?.trim();
  const href = link.getAttribute("href") ?? "";
  if (!content || !/^https?:\/\//i.test(href)) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const filePath = url.searchParams.get("path");
  const line = Number(url.searchParams.get("line"));
  if (!filePath?.startsWith("/") || !Number.isInteger(line) || line < 1) return null;
  return { filePath, line, content };
}

// Marks a finding link while its comment is being posted and after it was
// posted, so a second click opens the link instead of posting again.
export const POST_STATE_ATTR = "data-ado-comment-state";
const STATUS_ATTR = "data-ado-comment-status";

export async function postFromLink(
  link: Element,
  comment: ResultComment,
  post: (comment: ResultComment) => Promise<void>,
  href: string,
) {
  link.setAttribute(POST_STATE_ATTR, "posting");
  // A retry after a failure replaces the previous status instead of adding another.
  const previous = link.nextElementSibling;
  if (previous?.hasAttribute(STATUS_ATTR)) previous.remove();
  const status = link.ownerDocument.createElement("span");
  status.setAttribute(STATUS_ATTR, "");
  status.style.cssText = "margin-left:6px;font-size:.85em;opacity:.8";
  status.textContent = "投稿中…";
  link.after(status);
  try {
    await post(comment);
    link.setAttribute(POST_STATE_ATTR, "posted");
    status.textContent = "投稿済み";
    void openExternalUrl(href).catch(() => undefined);
  } catch (error) {
    link.removeAttribute(POST_STATE_ATTR);
    status.textContent = `投稿できません: ${commandErrorMessage(error)}`;
  }
}
