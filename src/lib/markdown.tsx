import { useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { marked, type TokenizerAndRendererExtension } from "marked";
import { openExternalUrl } from "@/lib/openExternal";

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

// Azure DevOps pastes images into PR descriptions/comments as
// "![name](https://.../attachments/Screenshot 2026-07-05.png)" without
// percent-encoding the space in the attachment file name. Strict CommonMark
// terminates the link destination at the first raw space, so marked drops the
// image and leaves the raw "![alt](..." text visible in the preview. This
// extension only takes over destinations that contain a raw space and are
// http(s) or root-relative (not title syntax, which the standard parser
// already handles), and encodes the space so the image renders. It runs as a
// real marked token, so it never fires inside code spans or fenced code
// blocks.
const azdoImageExtension: TokenizerAndRendererExtension = {
  name: "azdoImage",
  level: "inline",
  start(src) {
    const index = src.indexOf("![");
    return index < 0 ? undefined : index;
  },
  tokenizer(src) {
    const prefix = /^!\[([^\]\n]*)\]\(/.exec(src);
    if (!prefix) return undefined;
    const destinationStart = prefix[0].length;
    let nestedParens = 0;
    let destinationEnd = -1;
    for (let index = destinationStart; index < src.length && src[index] !== "\n"; index += 1) {
      if (src[index] === "\\") {
        index += 1;
      } else if (src[index] === "(") {
        nestedParens += 1;
      } else if (src[index] === ")") {
        if (nestedParens === 0) {
          destinationEnd = index;
          break;
        }
        nestedParens -= 1;
      }
    }
    if (destinationEnd < 0) return undefined;
    const dest = src.slice(destinationStart, destinationEnd).trim();
    // No raw space means the standard parser already handles this correctly.
    if (!dest.includes(" ")) return undefined;
    // "<url>" and 'url "title"' forms are handled correctly by the standard parser.
    if (dest.startsWith("<")) return undefined;
    if (/^\S+\s+("[^"]*"|'[^']*')$/.test(dest)) return undefined;
    // Only treat http(s) or root-relative (protocol-relative "//" excluded) as an image.
    if (!/^(https?:\/\/|\/(?!\/))/i.test(dest)) return undefined;
    return {
      type: "azdoImage",
      raw: src.slice(0, destinationEnd + 1),
      text: prefix[1],
      href: dest.replace(/ /g, "%20"),
    };
  },
  renderer(token) {
    // The output passes through DOMPurify in renderMarkdownHtml, but escape
    // quotes and & up front so nothing can break out of the attributes.
    const href = String(token.href).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const alt = String(token.text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
    return `<img src="${href}" alt="${alt}">`;
  },
};

marked.use({ extensions: [azdoMentionExtension, azdoImageExtension] });

// Image sources are restricted to schemes that cannot exfiltrate beyond a plain
// image fetch. https/data match the project's existing rich-text handling, and
// blob covers locally hydrated attachment images.
const SAFE_IMAGE_SCHEME = /^(https?:|data:|blob:)/i;

// A relative URL (no scheme, e.g. "/org/proj/_apis/.../attachments/x.png") is
// resolved against `baseUrl` for hydration below, so it must not be stripped
// here. A protocol-relative URL ("//evil.com/x.png") has no explicit scheme
// but still resolves to an external host, so it is treated as unsafe.
const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// Harden the sanitized output: external links must not leak the opener or
// referrer (tabnabbing), and images must not act as trackers via referrer or
// unsafe schemes. DOMPurify already drops javascript: URLs; this also strips
// any other unexpected image scheme so only safe fetches (and same-origin
// relative paths) remain.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("target") === "_blank") {
    node.setAttribute("rel", "noopener noreferrer");
  }
  if (node.tagName === "IMG") {
    const src = node.getAttribute("src");
    if (src) {
      const trimmed = src.trim();
      const keep =
        SAFE_IMAGE_SCHEME.test(trimmed) ||
        (!EXPLICIT_SCHEME.test(trimmed) && !trimmed.startsWith("//"));
      if (!keep) node.removeAttribute("src");
    }
    node.setAttribute("referrerpolicy", "no-referrer");
  }
});

export function renderMarkdownHtml(text: string): string {
  const html = marked.parse(text, { async: false, gfm: true, breaks: true });
  return DOMPurify.sanitize(html, {
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
].join(" ");

// Azure DevOps embeds description/comment images as authenticated attachment
// URLs: either the rich-text editor's shared `_apis/wit/attachments/` store, or
// (for images pasted into a PR description/comment) the PR-scoped
// `_apis/git/repositories/{repoId}/pullRequests/{prId}/attachments/{fileName}`
// endpoint. A plain <img> fetch from the webview omits the PAT/bearer auth, so
// the image 401s and renders broken. Resolve those to data URLs through the
// backend instead. Other schemes (data/blob) and non-attachment URLs (e.g.
// README images) are left untouched.
const PR_ATTACHMENT_PATH =
  /\/_apis\/git\/repositories\/[^/]+\/pullrequests\/[^/]+\/attachments\/[^/]+/;

function toAzdoAttachmentUrl(src: string, baseUrl: string | null | undefined): string | null {
  try {
    const url = new URL(src, baseUrl || window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const path = url.pathname.toLowerCase();
    if (!path.includes("/_apis/wit/attachments/") && !PR_ATTACHMENT_PATH.test(path)) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Renders sanitized markdown. Links open in the external browser instead of
 * navigating the app webview. When `resolveImageSource` is provided,
 * authenticated Azure DevOps attachment images are hydrated to data URLs so
 * they display instead of failing as unauthenticated fetches.
 */
export function MarkdownView({
  text,
  className,
  resolveImageSource,
  baseUrl,
}: {
  text: string;
  className?: string;
  resolveImageSource?: (url: string) => Promise<string | null>;
  baseUrl?: string | null;
}) {
  const html = useMemo(() => renderMarkdownHtml(text), [text]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !resolveImageSource) return;
    let cancelled = false;
    for (const image of Array.from(root.querySelectorAll("img"))) {
      const rawSrc = image.getAttribute("src");
      if (!rawSrc || /^(data|blob):/i.test(rawSrc) || image.dataset.azdoImageHydrated) {
        continue;
      }
      const attachmentUrl = toAzdoAttachmentUrl(rawSrc, baseUrl);
      if (!attachmentUrl) continue;
      image.dataset.azdoImageHydrated = "true";
      void resolveImageSource(attachmentUrl)
        .then((dataUrl) => {
          if (cancelled || !dataUrl || !image.isConnected) return;
          image.src = dataUrl;
        })
        .catch(() => {
          if (cancelled || !image.isConnected) return;
          const fallback = document.createElement("span");
          fallback.textContent = "Image could not be loaded.";
          fallback.className = "text-xs italic text-muted-foreground";
          image.replaceWith(fallback);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [html, resolveImageSource, baseUrl]);

  return (
    <div
      ref={containerRef}
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
