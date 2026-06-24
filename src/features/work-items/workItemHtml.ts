/**
 * Pure helpers for rendering Azure DevOps rich text (descriptions, comments)
 * into sanitized HTML for the preview iframe: image hydration, markdown-ish
 * fallback rendering, mention display-name substitution, and HTML escaping.
 * No React — kept separate from the component so it can be unit-tested.
 */

import DOMPurify from "dompurify";

import { replaceMentionTokensWithDisplayNames } from "@/lib/mentions";

export function hydrateAuthenticatedImages(
  doc: Document,
  baseUrl: string | null | undefined,
  resolveImageSource: ((url: string) => Promise<string | null>) | undefined,
  syncHeight: () => void,
) {
  if (!resolveImageSource) return;

  for (const image of Array.from(doc.querySelectorAll("img"))) {
    const rawSrc = image.getAttribute("src");
    if (!rawSrc || isInlineImageSource(rawSrc) || image.dataset.azdoImageHydrated) {
      continue;
    }

    const absoluteUrl = toAbsoluteHttpUrl(rawSrc, baseUrl);
    if (!absoluteUrl) continue;
    if (!isWorkItemAttachmentUrl(absoluteUrl)) continue;

    image.dataset.azdoImageHydrated = "true";
    void resolveImageSource(absoluteUrl)
      .then((dataUrl) => {
        if (!dataUrl || !image.isConnected) return;
        image.src = dataUrl;
        syncHeight();
      })
      .catch(() => {
        image.dataset.azdoImageError = "true";
        const fallback = doc.createElement("span");
        fallback.textContent = "Image could not be loaded. Check Azure DevOps auth or attachment permissions.";
        fallback.className = "azdo-image-error";
        image.replaceWith(fallback);
        syncHeight();
      });
  }
}

function isWorkItemAttachmentUrl(src: string): boolean {
  try {
    return new URL(src).pathname.toLowerCase().includes("/_apis/wit/attachments/");
  } catch {
    return false;
  }
}

function isInlineImageSource(src: string): boolean {
  return /^(data|blob):/i.test(src);
}

function toAbsoluteHttpUrl(src: string, baseUrl: string | null | undefined): string | null {
  try {
    const url = new URL(src, baseUrl || window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

// Strip raw Azure DevOps service HTML to a safe subset before it reaches the
// preview iframe. DOMPurify removes <script>, <meta> (so meta-refresh cannot
// run), on* handlers, and dangerous URI schemes while keeping the markup the
// web UI relies on (mentions, links, images, tables). `data-*` attributes such
// as `data-vss-mention` and the hydration markers survive the html profile.
// `target`/`referrerpolicy` are allowed so links keep opening in a new tab and
// images do not leak a Referer to external trackers. The image hook is scoped
// to this call so it cannot affect other DOMPurify users (e.g. markdown.tsx).
function setImageReferrerPolicy(node: Element) {
  if (node.tagName === "IMG") {
    node.setAttribute("referrerpolicy", "no-referrer");
  }
}

function sanitizeRichHtml(html: string): string {
  DOMPurify.addHook("afterSanitizeAttributes", setImageReferrerPolicy);
  try {
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ["target", "referrerpolicy"],
    });
  } finally {
    DOMPurify.removeHook("afterSanitizeAttributes");
  }
}

export function buildRichHtmlDocument(
  html: string,
  density: "compact" | "comfortable" = "compact",
): string {
  const fontSize = density === "comfortable" ? 14 : 12;
  const lineHeight = density === "comfortable" ? 1.55 : 1.35;
  const paragraphMargin = density === "comfortable" ? 10 : 6;
  const safeHtml = sanitizeRichHtml(html);
  return `<!doctype html>
<html>
<head>
  <base target="_blank">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body { margin: 0; padding: 0; background: #fff; }
    body {
      box-sizing: border-box;
      color: #0f172a;
      font: ${fontSize}px/${lineHeight} -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow-wrap: anywhere;
    }
    * { box-sizing: border-box; }
    p { margin: 0 0 ${paragraphMargin}px; }
    p:last-child, ul:last-child, ol:last-child, table:last-child, pre:last-child { margin-bottom: 0; }
    ul, ol { margin: 0 0 ${paragraphMargin}px 20px; padding: 0; }
    li { margin: 3px 0; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .azdo-mention { color: #2563eb; font-weight: 500; }
    img, video { max-width: 100%; height: auto; border: 1px solid #dbe3ef; border-radius: 4px; }
    img { cursor: zoom-in; }
    .azdo-image-error {
      display: inline-block;
      margin: 2px 0;
      padding: 6px 8px;
      color: #991b1b;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 4px;
    }
    table { width: 100%; margin: 0 0 ${paragraphMargin}px; border-collapse: collapse; font-size: ${fontSize}px; }
    th, td { border: 1px solid #dbe3ef; padding: 5px 7px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; font-weight: 600; }
    pre, code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; }
    pre { margin: 0 0 6px; padding: 6px; overflow: auto; border: 1px solid #dbe3ef; border-radius: 4px; background: #f8fafc; }
    blockquote { margin: 0 0 6px; padding-left: 8px; border-left: 2px solid #cbd5e1; color: #475569; }
  </style>
</head>
<body>${safeHtml}</body>
</html>`;
}

function normalizeRichHtml(value: string | null | undefined): string | null {
  const html = decodeEscapedRichHtml(value)?.trim();
  if (!html) return null;
  if (/<\/?[a-z][^>]*>/i.test(html) || /<(img|video|table|pre|blockquote|ul|ol|li|a)\b/i.test(html)) {
    return html;
  }
  return null;
}

export function richFieldHtml(value: string | null | undefined): string | null {
  return normalizeRichHtml(value) ?? markdownishTextToHtml(value);
}

function decodeEscapedRichHtml(value: string | null | undefined): string | null {
  const html = value?.trim();
  if (!html) return null;
  if (!/&lt;\/?(?:a|blockquote|br|div|img|li|ol|p|pre|span|strong|table|td|th|tr|ul)\b/i.test(html)) {
    return html;
  }
  const decoded = decodeBasicHtmlEntities(html);
  return /<\/?[a-z][^>]*>/i.test(decoded) ? decoded : html;
}

export function commentRichHtml(
  renderedText: string | null | undefined,
  plainText: string | null | undefined,
  mentionDisplayNames: ReadonlyMap<string, string>,
): string {
  // Substitute mention tokens on the final HTML so both the rendered-HTML
  // path and the escaped plain-text path produce the same styled mention.
  const html =
    normalizeRichHtml(renderedText) ??
    normalizeRichHtml(plainText) ??
    markdownishTextToHtml(plainText) ??
    "No text";
  return replaceMentionTokensWithDisplayNames(html, mentionDisplayNames) ?? html;
}

function markdownishTextToHtml(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let listItems: string[] = [];
  let tableRows: string[][] = [];
  let codeLines: string[] = [];
  let inCode = false;

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };
  const flushTable = () => {
    if (tableRows.length === 0) return;
    const [head, ...body] = tableRows;
    blocks.push(
      `<table><thead><tr>${head.map((cell) => `<th>${formatInlineMarkdown(cell)}</th>`).join("")}</tr></thead><tbody>${body
        .map((row) => `<tr>${row.map((cell) => `<td>${formatInlineMarkdown(cell)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`,
    );
    tableRows = [];
  };
  const flushCode = () => {
    if (codeLines.length === 0) return;
    blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n")) ?? ""}</code></pre>`);
    codeLines = [];
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inCode) {
        inCode = false;
        flushCode();
      } else {
        flushList();
        flushTable();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      flushTable();
      continue;
    }

    const listMatch = /^[-*]\s+(.+)$/.exec(trimmed);
    if (listMatch) {
      flushTable();
      listItems.push(listMatch[1]);
      continue;
    }

    if (isMarkdownTableRow(trimmed)) {
      flushList();
      if (!/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(trimmed)) {
        tableRows.push(splitMarkdownTableRow(trimmed));
      }
      continue;
    }

    flushList();
    flushTable();
    blocks.push(`<p>${formatInlineMarkdown(trimmed)}</p>`);
  }

  flushList();
  flushTable();
  flushCode();
  return blocks.join("");
}

function isMarkdownTableRow(value: string): boolean {
  return value.includes("|") && splitMarkdownTableRow(value).length >= 2;
}

function splitMarkdownTableRow(value: string): string[] {
  return value.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function formatInlineMarkdown(value: string): string {
  let html = escapeHtml(value) ?? "";
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return html;
}

export function commentAuthorInitials(name: string | null | undefined): string {
  const normalized = name?.trim();
  if (!normalized) return "?";
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return [...normalized].slice(0, 2).join("").toUpperCase();
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeHtml(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

