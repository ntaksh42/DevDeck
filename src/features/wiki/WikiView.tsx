import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { commandErrorMessage, getWikiPage, searchWikiPages } from "@/lib/azdoCommands";
import { useActiveOrganizationId } from "@/lib/useActiveConnection";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { openExternalUrl } from "@/lib/openExternal";
import { MarkdownView } from "@/lib/markdown";
import { ErrorState, LoadingState, PreviewEmptyState } from "@/components/StateDisplay";
import { WikiSearchResultsList } from "./WikiSearchResultsList";

const SEARCH_DEBOUNCE_MS = 300;

// Wiki search + preview (issue #400): a keyword search box, a keyboard-
// navigable list of matching pages, and a Markdown preview pane. Editing stays
// out of scope — the preview links out to Azure DevOps for that. Azure DevOps
// only; on a GitHub connection the search/preview commands return a
// `NotSupported` error that renders here like any other command failure (the
// nav entry itself is hidden via `capabilities.wiki`, mirroring Pipelines).
export function WikiView() {
  const organizationId = useActiveOrganizationId();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const trimmedQuery = debouncedQuery.trim();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const searchQuery = useQuery({
    queryKey: ["wikiSearch", organizationId, trimmedQuery],
    queryFn: () => searchWikiPages({ organizationId, query: trimmedQuery }),
    enabled: !!organizationId && !!trimmedQuery,
    staleTime: 30_000,
  });
  const hits = searchQuery.data?.results ?? [];

  useEffect(() => {
    setSelectedIndex(0);
  }, [hits.length, trimmedQuery]);

  const selectedHit = hits[selectedIndex] ?? null;

  const pageQuery = useQuery({
    queryKey: ["wikiPage", organizationId, selectedHit?.wikiId, selectedHit?.path],
    queryFn: () =>
      getWikiPage({
        organizationId,
        project: selectedHit!.projectName,
        wikiId: selectedHit!.wikiId,
        path: selectedHit!.path,
      }),
    enabled: !!organizationId && !!selectedHit,
    staleTime: 30_000,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search wiki pages…"
          aria-label="Search wiki pages"
          data-filter-input="true"
          disabled={!organizationId}
          className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {searchQuery.data?.notice ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {searchQuery.data.notice}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden rounded-md border border-border bg-card lg:grid-cols-[minmax(260px,360px)_1px_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col">
          {searchQuery.isError ? (
            <div className="p-3">
              <ErrorState message={commandErrorMessage(searchQuery.error)} />
            </div>
          ) : (
            <WikiSearchResultsList
              hits={hits}
              selectedIndex={selectedIndex}
              onSelectIndex={setSelectedIndex}
              loading={searchQuery.isLoading}
              searched={!!trimmedQuery}
            />
          )}
        </div>
        <div className="hidden border-l border-border lg:block" />
        <div
          data-primary-preview="true"
          tabIndex={-1}
          className="flex min-h-0 flex-col overflow-y-auto outline-none"
        >
          {!selectedHit ? (
            <PreviewEmptyState message="Select a wiki page to preview its content." />
          ) : pageQuery.isLoading ? (
            <LoadingState />
          ) : pageQuery.isError ? (
            <div className="p-3">
              <ErrorState message={commandErrorMessage(pageQuery.error)} />
            </div>
          ) : pageQuery.data ? (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <h2 className="min-w-0 truncate text-sm font-semibold">{selectedHit.fileName}</h2>
                <button
                  type="button"
                  onClick={() => void openExternalUrl(pageQuery.data!.webUrl)}
                  title="Open in Azure DevOps (O)"
                  className="shrink-0 rounded border border-border bg-card px-2 py-0.5 text-xs text-primary hover:bg-secondary"
                >
                  Open
                </button>
              </div>
              <div className="px-3 py-2">
                <MarkdownView text={pageQuery.data.content} />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
