import type { SelectedMention } from "./workItemMentions";

/**
 * Turns a stored comment back into the plain text the comment editors show:
 * `@<guid>` mention tokens become `@Display Name` (and are returned as selected
 * mentions so saving converts them back), and HTML comments written in the
 * Azure DevOps rich editor become markdown. Without this the edit box showed
 * raw GUIDs, or the HTML source of a web UI comment.
 */
export type EditableDraft = { text: string; mentions: SelectedMention[] };

// Azure DevOps renders a mention as
// <a href="#" data-vss-mention="version:2.0,{guid}">@Name</a>.
function mentionIdFromAttribute(value: string | null): string | null {
  if (!value) return null;
  const id = value.split(",").pop()?.trim();
  return id ? id : null;
}

function mentionNameFromText(text: string | null): string {
  return (text ?? "").trim().replace(/^@/, "").trim();
}

function parseHtml(html: string): Document | null {
  if (typeof DOMParser === "undefined") return null;
  return new DOMParser().parseFromString(html, "text/html");
}

/** Display names of the mentions in Azure DevOps-rendered comment HTML, keyed by lower-case id. */
export function mentionNamesFromHtml(html: string | null | undefined): Map<string, string> {
  const names = new Map<string, string>();
  if (!html || !html.includes("data-vss-mention")) return names;
  const doc = parseHtml(html);
  if (!doc) return names;
  for (const anchor of doc.querySelectorAll("a[data-vss-mention]")) {
    const id = mentionIdFromAttribute(anchor.getAttribute("data-vss-mention"));
    const name = mentionNameFromText(anchor.textContent);
    if (id && name) names.set(id.toLowerCase(), name);
  }
  return names;
}

function addMention(mentions: SelectedMention[], id: string, displayName: string) {
  if (!mentions.some((mention) => mention.id.toLowerCase() === id.toLowerCase())) {
    mentions.push({ id, displayName, uniqueName: null });
  }
}

/**
 * Replaces `@<id>` tokens outside code with `@Name` when the name is known.
 * Unknown ids stay as `@<id>`, which still saves as a working mention.
 */
export function markdownMentionsToEditable(
  markdown: string,
  names: ReadonlyMap<string, string>,
): EditableDraft {
  const mentions: SelectedMention[] = [];
  let inFence = false;
  const lines = markdown.split("\n").map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    // Odd segments of a backtick split are inline code.
    return line
      .split("`")
      .map((segment, index) =>
        index % 2 === 1
          ? segment
          : segment.replace(/@<([^<>\s]+)>/g, (token, id: string) => {
              const name = names.get(id) ?? names.get(id.toLowerCase());
              if (!name) return token;
              addMention(mentions, id, name);
              return `@${name}`;
            }),
      )
      .join("`");
  });
  return { text: lines.join("\n"), mentions };
}

/**
 * Drops the trailing two-space hard-break markers that `markdownWithHardLineBreaks`
 * added on save, so they do not pile up each time a comment is edited.
 */
export function stripHardLineBreaks(markdown: string): string {
  let inFence = false;
  return markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      return inFence ? line : line.replace(/ {2,}$/, "");
    })
    .join("\n");
}

const BLOCK_TAGS = new Set([
  "P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6",
  "BLOCKQUOTE", "PRE", "TABLE", "TR",
]);

function inlineMarkdown(node: Node, mentions: SelectedMention[]): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").replace(/\s+/g, " ");
  }
  if (!(node instanceof Element)) return "";
  const children = () =>
    [...node.childNodes].map((child) => inlineMarkdown(child, mentions)).join("");
  switch (node.tagName) {
    case "BR":
      return "\n";
    case "A": {
      const id = mentionIdFromAttribute(node.getAttribute("data-vss-mention"));
      const name = mentionNameFromText(node.textContent);
      if (id && name) {
        addMention(mentions, id, name);
        return `@${name}`;
      }
      const href = node.getAttribute("href") ?? "";
      const text = children();
      return href && href !== "#" && href !== text ? `[${text}](${href})` : text;
    }
    case "IMG": {
      const src = node.getAttribute("src") ?? "";
      return src ? `![${node.getAttribute("alt") ?? ""}](${src})` : "";
    }
    case "B":
    case "STRONG": {
      const text = children();
      return text.trim() ? `**${text}**` : text;
    }
    case "I":
    case "EM": {
      const text = children();
      return text.trim() ? `_${text}_` : text;
    }
    case "CODE":
      return node.parentElement?.tagName === "PRE" ? children() : `\`${children()}\``;
    default:
      return children();
  }
}

function blockMarkdown(node: Element, mentions: SelectedMention[], lines: string[]) {
  let current = "";
  const flush = () => {
    if (current.trim()) {
      for (const line of current.split("\n")) lines.push(line.trim());
    } else if (current.includes("\n")) {
      // The rich editor writes an empty line as <div><br></div>.
      lines.push("");
    }
    current = "";
  };
  for (const child of node.childNodes) {
    if (child instanceof Element && BLOCK_TAGS.has(child.tagName)) {
      flush();
      if (child.tagName === "PRE") {
        lines.push("```", ...(child.textContent ?? "").replace(/\n$/, "").split("\n"), "```");
      } else if (child.tagName === "LI") {
        const itemLines: string[] = [];
        blockMarkdown(child, mentions, itemLines);
        const marker = child.parentElement?.tagName === "OL" ? "1." : "-";
        itemLines
          .filter((line) => line !== "")
          .forEach((line, index) => lines.push(index === 0 ? `${marker} ${line}` : `  ${line}`));
      } else {
        blockMarkdown(child, mentions, lines);
      }
    } else {
      current += inlineMarkdown(child, mentions);
    }
  }
  flush();
}

/** Converts the HTML of a rich-editor comment into editable markdown. */
export function htmlCommentToEditable(html: string): EditableDraft {
  const mentions: SelectedMention[] = [];
  const doc = parseHtml(html);
  if (!doc) return { text: html, mentions };
  const lines: string[] = [];
  blockMarkdown(doc.body, mentions, lines);
  const text = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, mentions };
}

/** The editable draft for a stored comment, whatever format it was saved in. */
export function editableCommentDraft(
  text: string | null | undefined,
  options: { format?: string | null; names?: ReadonlyMap<string, string> } = {},
): EditableDraft {
  const source = text ?? "";
  const format = options.format?.toLowerCase();
  // Older responses (and some fixtures) omit `format`; rich-editor HTML still
  // starts with a block or inline tag.
  const looksLikeHtml = /^\s*<(div|p|span|a|br|ul|ol|table|h[1-6])\b/i.test(source);
  if (format === "html" || (!format && looksLikeHtml)) return htmlCommentToEditable(source);
  return markdownMentionsToEditable(stripHardLineBreaks(source), options.names ?? new Map());
}
