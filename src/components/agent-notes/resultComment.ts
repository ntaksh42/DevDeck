// A finding link in a PR review result can carry the comment to post on that
// line: `<a href="{PR}?_a=files&path=/src/x.ts&line=42…" data-ado-comment="…">`.
// Clicking it in DevDeck posts the comment as a new thread on the line, then
// opens the link (see ResultFrame). Links without the attribute, a path or a
// line stay plain links.

import { commandErrorMessage } from "@/lib/azdoCommands";

export type ResultComment = { filePath: string; line: number; content: string };

export const RESULT_COMMENT_ATTR = "data-ado-comment";
/** "posting" | "posted" | "failed" on a finding link; shown by RESULT_COMMENT_CSS. */
export const POST_STATE_ATTR = "data-ado-comment-state";
const ERROR_ATTR = "data-ado-comment-error";

// The state is drawn with ::after so no text is added to the result: agent
// note quotes are matched against the result's text and must not pick it up.
export const RESULT_COMMENT_CSS =
  `a[${POST_STATE_ATTR}]::after{margin-left:6px;font-size:.85em;opacity:.8}` +
  `a[${POST_STATE_ATTR}="posting"]::after{content:"投稿中…"}` +
  `a[${POST_STATE_ATTR}="posted"]::after{content:"投稿済み"}` +
  `a[${POST_STATE_ATTR}="failed"]::after{content:"投稿できません: " attr(${ERROR_ATTR})}`;

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

// Comments already posted, kept outside the result document: the document is
// rebuilt whenever the row changes or the result reloads, and a mark on the
// link alone would let the same comment be posted again.
const STORE_KEY = "devdeck.resultComments.posted";
const STORE_LIMIT = 500;
const memory = new Set<string>();

function loadPosted(): string[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function commentKey(scope: string, comment: ResultComment): string {
  return `${scope}|${comment.filePath}|${comment.line}|${comment.content}`;
}

export function wasPosted(key: string): boolean {
  return memory.has(key) || loadPosted().includes(key);
}

export function rememberPosted(key: string): void {
  memory.add(key);
  try {
    const list = loadPosted().filter((v) => v !== key);
    list.push(key);
    window.localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(-STORE_LIMIT)));
  } catch {
    // Storage may be unavailable; the in-memory record still covers this session.
  }
}

export type CommentPoster = {
  /** Identifies the pull request, so the same text on another PR is a different comment. */
  scope: string;
  post: (comment: ResultComment) => Promise<void>;
};

/** Shows each finding link's comment as its tooltip and marks the ones already posted. */
export function prepareResultLinks(doc: Document, poster: CommentPoster | undefined): void {
  if (!poster) return;
  doc.querySelectorAll(`a[${RESULT_COMMENT_ATTR}]`).forEach((link) => {
    const comment = readResultComment(link);
    if (!comment) return;
    link.setAttribute("title", `押すと PR のこの行に投稿します:\n${comment.content}`);
    if (wasPosted(commentKey(poster.scope, comment))) link.setAttribute(POST_STATE_ATTR, "posted");
  });
}

/**
 * A click on a result link: post its comment once when it has one, then open
 * the link. Returns once the post (if any) settles.
 */
export async function handleResultLinkClick(
  link: Element,
  href: string,
  poster: CommentPoster | undefined,
  open: (href: string) => void,
): Promise<void> {
  const comment = poster ? readResultComment(link) : null;
  if (!poster || !comment) {
    open(href);
    return;
  }
  const state = link.getAttribute(POST_STATE_ATTR);
  if (state === "posting") return;
  const key = commentKey(poster.scope, comment);
  if (state === "posted" || wasPosted(key)) {
    link.setAttribute(POST_STATE_ATTR, "posted");
    open(href);
    return;
  }
  link.setAttribute(POST_STATE_ATTR, "posting");
  link.removeAttribute(ERROR_ATTR);
  try {
    await poster.post(comment);
    rememberPosted(key);
    link.setAttribute(POST_STATE_ATTR, "posted");
    open(href);
  } catch (error) {
    link.setAttribute(POST_STATE_ATTR, "failed");
    link.setAttribute(ERROR_ATTR, commandErrorMessage(error));
  }
}
