import type { WikiSearchHit } from "@/lib/azdoCommands";

// The command palette lives outside the view tree, so it asks the app shell's
// WikiPreviewHost to open a page preview through a window custom event.
export const OPEN_WIKI_PAGE_EVENT = "azdodeck:wiki:open-page";

export type OpenWikiPageDetail = {
  organizationId?: string;
  hit: WikiSearchHit;
};

export function openWikiPagePreview(detail: OpenWikiPageDetail): void {
  window.dispatchEvent(new CustomEvent(OPEN_WIKI_PAGE_EVENT, { detail }));
}
