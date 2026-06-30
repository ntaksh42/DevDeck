import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef } from "react";
import { FileText } from "lucide-react";
import { type WikiSearchHit } from "@/lib/azdoCommands";
import { clamp, isEditableTarget, focusPrimaryPreview } from "@/lib/utils";
import { openExternalUrl } from "@/lib/openExternal";
import { LoadingState } from "@/components/StateDisplay";

// Keyboard-navigable list of wiki search hits. Mirrors the row-navigation
// conventions used by the commit/PR grids (↑↓/J K/Home/End, Enter focuses the
// preview, O/Ctrl+Enter opens the page in the browser), trimmed down for a
// small, non-virtualized result set (the backend already caps at ~25 hits).
export function WikiSearchResultsList({
  hits,
  selectedIndex,
  onSelectIndex,
  loading,
  searched,
}: {
  hits: WikiSearchHit[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  loading: boolean;
  searched: boolean;
}) {
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    rowRefs.current[selectedIndex]?.focus({ preventScroll: true });
  }, [selectedIndex]);

  function moveSelection(delta: number) {
    onSelectIndex(clamp(selectedIndex + delta, 0, hits.length - 1));
  }

  function handleKeyDown(event: ReactKeyboardEvent) {
    if (isEditableTarget(event.target)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key === "Enter") {
        event.preventDefault();
        const hit = hits[selectedIndex];
        if (hit) void openExternalUrl(hit.webUrl);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "j" || event.key === "J") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp" || event.key === "k" || event.key === "K") {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      onSelectIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      onSelectIndex(hits.length - 1);
    } else if (event.key === "Enter" || event.key === "ArrowRight") {
      event.preventDefault();
      focusPrimaryPreview();
    } else if (event.key === "o" || event.key === "O") {
      event.preventDefault();
      const hit = hits[selectedIndex];
      if (hit) void openExternalUrl(hit.webUrl);
    }
  }

  if (loading) return <LoadingState />;
  if (!searched) {
    return (
      <div className="px-3 py-6 text-center text-sm text-muted-foreground">
        Search for a keyword to find wiki pages.
      </div>
    );
  }
  if (hits.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-sm text-muted-foreground">
        No wiki pages matched.
      </div>
    );
  }

  return (
    <div
      role="grid"
      aria-label="Wiki search results"
      data-primary-grid="true"
      tabIndex={-1}
      className="min-h-0 flex-1 overflow-y-auto outline-none"
      onKeyDown={handleKeyDown}
    >
      {hits.map((hit, index) => (
        <div
          key={`${hit.wikiId}:${hit.path}`}
          ref={(el) => {
            rowRefs.current[index] = el;
          }}
          role="row"
          aria-selected={index === selectedIndex}
          tabIndex={index === selectedIndex ? 0 : -1}
          onClick={() => onSelectIndex(index)}
          onFocus={() => onSelectIndex(index)}
          className={`flex w-full min-w-0 cursor-pointer items-start gap-2 border-b border-border/60 px-3 py-2 text-left text-sm outline-none ${
            index === selectedIndex ? "bg-secondary" : "hover:bg-muted/50"
          }`}
        >
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{hit.fileName}</span>
              <span className="shrink-0 truncate text-xs text-muted-foreground">
                {hit.projectName}
              </span>
            </div>
            <p className="truncate font-mono text-xs text-muted-foreground">{hit.path}</p>
            {hit.snippet ? (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{hit.snippet}</p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
