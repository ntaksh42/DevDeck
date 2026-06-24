import { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked, type TokenizerAndRendererExtension } from "marked";
import { openExternalUrl } from "@/lib/openExternal";
import { replaceMentionTokensWithDisplayNames } from "@/lib/mentions";

const EMPTY_MENTION_NAMES: ReadonlyMap<string, string> = new Map();

// Azure DevOps stores @mentions as "@<identity-guid>" markdown. The browser has
// no display name for the guid, and without help marked parses "<guid>" as
// inline HTML that DOMPurify then drops, leaving only a stray "@" (or a raw id)
// in the preview. This inline extension keeps the literal token visible as
// text. It runs as a real marked token, so it never fires inside code spans or
// fenced code blocks where "@<guid>" must stay verbatim.
const azdoMentionExtension: TokenizerAndRendererExtension = {
  name: "azdoMention",
  level: "inline",
  start(src) {
    const index = src.indexOf("@<");
    return index < 0 ? undefined : index;
  },
  tokenizer(src) {
    const match = /^@<([^<>\s]+)>/.exec(src);
    if (!match) return undefined;
    return { type: "azdoMention", raw: match[0], text: match[1] };
  },
  renderer(token) {
    return `@&lt;${escapeMentionText(String(token.text))}&gt;`;
  },
};

function escapeMentionText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

marked.use({ extensions: [azdoMentionExtension] });

// Image sources are restricted to schemes that cannot exfiltrate beyond a plain
// image fetch. https/data match the project's existing rich-text handling, and
// blob covers locally hydrated attachment images.
const SAFE_IMAGE_SCHEME = /^(https?:|data:|blob:)/i;

// Harden the sanitized output: external links must not leak the opener or
// referrer (tabnabbing), and images must not act as trackers via referrer or
// unsafe schemes. DOMPurify already drops javascript: URLs; this also strips
// any other unexpected image scheme so only safe fetches remain.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("target") === "_blank") {
    node.setAttribute("rel", "noopener noreferrer");
  }
  if (node.tagName === "IMG") {
    const src = node.getAttribute("src");
    if (src && !SAFE_IMAGE_SCHEME.test(src.trim())) {
      node.removeAttribute("src");
    }
    node.setAttribute("referrerpolicy", "no-referrer");
  }
});

export function renderMarkdownHtml(
  text: string,
  mentionDisplayNames: ReadonlyMap<string, string> = EMPTY_MENTION_NAMES,
): string {
  const html = marked.parse(text, { async: false, gfm: true, breaks: true });
  // The mention extension above leaves each token as escaped `@&lt;id&gt;`
  // text. Resolve those to display-name spans before sanitizing so the injected
  // markup is sanitized too; unknown ids stay visible as the literal token.
  const withMentions =
    replaceMentionTokensWithDisplayNames(html, mentionDisplayNames) ?? html;
  return DOMPurify.sanitize(withMentions, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target"],
  });
}

const MARKDOWN_CLASSES = [
  "break-words",
  "[&_p]:my-1",
  "[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4",
  "[&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4",
  "[&_h1]:mt-2 [&_h1]:text-sm [&_h1]:font-semibold",
  "[&_h2]:mt-2 [&_h2]:text-sm [&_h2]:font-semibold",
  "[&_h3]:mt-2 [&_h3]:font-semibold",
  "[&_a]:text-primary [&_a]:underline",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em]",
  "[&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_table]:my-1 [&_table]:border-collapse",
  "[&_td]:border [&_td]:border-border [&_td]:px-1.5 [&_td]:py-0.5",
  "[&_th]:border [&_th]:border-border [&_th]:px-1.5 [&_th]:py-0.5 [&_th]:font-semibold",
  "[&_img]:max-w-full",
  "[&_hr]:my-2 [&_hr]:border-border",
  "[&_.azdo-mention]:font-medium [&_.azdo-mention]:text-primary",
].join(" ");

/**
 * Renders sanitized markdown. Links open in the external browser instead of
 * navigating the app webview.
 */
export function MarkdownView({
  text,
  className,
  mentionDisplayNames,
}: {
  text: string;
  className?: string;
  mentionDisplayNames?: ReadonlyMap<string, string>;
}) {
  const html = useMemo(
    () => renderMarkdownHtml(text, mentionDisplayNames ?? EMPTY_MENTION_NAMES),
    [text, mentionDisplayNames],
  );
  return (
    <div
      className={`${MARKDOWN_CLASSES} ${className ?? ""}`}
      onClick={(event) => {
        const anchor = (event.target as HTMLElement).closest("a");
        if (!anchor) return;
        event.preventDefault();
        const href = anchor.getAttribute("href");
        if (href && /^https?:\/\//i.test(href)) openExternalUrl(href);
      }}
      // The HTML below is sanitized by DOMPurify in renderMarkdownHtml.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
