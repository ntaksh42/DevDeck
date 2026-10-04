import { useEffect, useState } from "react";
import { OPEN_WIKI_PAGE_EVENT, type OpenWikiPageDetail } from "./wikiPreviewEvents";
import { WikiPageDialog } from "./WikiPageDialog";

export function WikiPreviewHost() {
  const [target, setTarget] = useState<OpenWikiPageDetail | null>(null);

  useEffect(() => {
    function onOpen(event: Event) {
      setTarget((event as CustomEvent<OpenWikiPageDetail>).detail);
    }
    window.addEventListener(OPEN_WIKI_PAGE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_WIKI_PAGE_EVENT, onOpen);
  }, []);

  if (!target) return null;
  return (
    <WikiPageDialog
      hit={target.hit}
      organizationId={target.organizationId}
      onClose={() => setTarget(null)}
    />
  );
}
