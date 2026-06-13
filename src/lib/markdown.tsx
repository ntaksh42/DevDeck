import { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { openExternalUrl } from "@/lib/openExternal";

export function renderMarkdownHtml(text: string): string {
  const html = marked.parse(text, { async: false, gfm: true, breaks: true });
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
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

/**
 * Renders sanitized markdown. Links open in the external browser instead of
 * navigating the app webview.
 */
export function MarkdownView({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdownHtml(text), [text]);
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
