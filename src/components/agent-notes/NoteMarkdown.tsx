import { useMemo } from "react";
import { renderMarkdownHtml } from "@/lib/markdown";
import { navigateToPullRequest, navigateToWorkItem } from "@/lib/crossLinks";
import { openExternalUrl } from "@/lib/openExternal";

// Note bodies and replies as sanitized Markdown, with `#123` (work item) and
// `!45` (pull request) turned into in-app links.

const ITEM_REF = /(^|[^\w&])([#!])(\d+)\b/g;

function linkItemRefs(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild!;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest("a,code,pre")) texts.push(node as Text);
  }
  for (const text of texts) {
    const value = text.nodeValue ?? "";
    if (!ITEM_REF.test(value)) continue;
    ITEM_REF.lastIndex = 0;
    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const match of value.matchAll(ITEM_REF)) {
      const start = (match.index ?? 0) + match[1].length;
      frag.append(value.slice(last, start));
      const link = doc.createElement("a");
      link.href = "#";
      link.textContent = `${match[2]}${match[3]}`;
      link.dataset[match[2] === "#" ? "workItem" : "pullRequest"] = match[3];
      frag.append(link);
      last = start + link.textContent.length;
    }
    frag.append(value.slice(last));
    text.replaceWith(frag);
  }
  return root.innerHTML;
}

const CLASSES =
  "break-words [&_p]:my-0.5 [&_ul]:my-0.5 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-4 " +
  "[&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.95em] " +
  "[&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-1.5 [&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground";

export function NoteMarkdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => linkItemRefs(renderMarkdownHtml(text)), [text]);
  return (
    <div
      className={`${CLASSES} ${className ?? ""}`}
      onClick={(event) => {
        const anchor = (event.target as HTMLElement).closest("a");
        if (!anchor) return;
        event.preventDefault();
        event.stopPropagation();
        const { workItem, pullRequest } = anchor.dataset;
        if (workItem) navigateToWorkItem({ workItemId: Number(workItem) });
        else if (pullRequest) navigateToPullRequest({ pullRequestId: Number(pullRequest) });
        else {
          const href = anchor.getAttribute("href");
          if (href && /^https?:\/\//i.test(href)) openExternalUrl(href);
        }
      }}
      // Sanitized by DOMPurify in renderMarkdownHtml; linkItemRefs only adds text links.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
