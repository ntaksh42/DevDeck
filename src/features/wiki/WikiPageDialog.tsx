import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, X } from "lucide-react";
import { commandErrorMessage, getWikiPage, type WikiSearchHit } from "@/lib/azdoCommands";
import { MarkdownView } from "@/lib/markdown";
import { openExternalUrl } from "@/lib/openExternal";

const FOCUSABLE = "button, [href], [tabindex]:not([tabindex='-1'])";

/**
 * Read-only preview of a wiki page found through palette search. Editing is a
 * non-goal: "Open in Azure DevOps" jumps to the browser. role="dialog" with
 * Escape to close, focus starting on the scrollable body (so arrows/PageDown
 * scroll immediately), Tab kept inside, and focus returned to the opener.
 */
export function WikiPageDialog({
  hit,
  organizationId,
  onClose,
}: {
  hit: WikiSearchHit;
  organizationId?: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const page = useQuery({
    queryKey: ["wikiPage", organizationId, hit.wikiId, hit.pagePath],
    queryFn: () =>
      getWikiPage({
        organizationId,
        projectId: hit.projectId,
        projectName: hit.projectName,
        wikiId: hit.wikiId,
        wikiName: hit.wikiName,
        pagePath: hit.pagePath,
      }),
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    bodyRef.current?.focus();
    return () => {
      window.setTimeout(() => opener?.focus(), 0);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const webUrl = page.data?.webUrl ?? hit.webUrl;
  const buttonClass =
    "inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Wiki page ${hit.pagePath}`}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-md border border-border bg-card shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-foreground">{hit.pagePath}</h2>
            <p className="truncate text-xs text-muted-foreground">
              {hit.projectName} / {hit.wikiName}
            </p>
          </div>
          <button
            type="button"
            className={buttonClass}
            onClick={() => void openExternalUrl(webUrl)}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            Open in Azure DevOps
          </button>
          <button type="button" className={buttonClass} onClick={onClose} aria-label="Close">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <div
          ref={bodyRef}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm focus:outline-none"
        >
          {page.isPending ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : page.isError ? (
            <p role="alert" className="text-destructive">
              {commandErrorMessage(page.error)}
            </p>
          ) : (
            <MarkdownView text={page.data.content} />
          )}
        </div>
      </div>
    </div>
  );
}
