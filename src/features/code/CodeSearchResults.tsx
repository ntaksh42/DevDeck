import { type ReactNode, useDeferredValue, useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FileCode, Loader2, X } from "lucide-react";
import {
  type CodeSearchHit,
  commandErrorMessage,
  getCodeSearchContext,
  searchCode,
} from "@/lib/azdoCommands";
import { ErrorState } from "@/components/StateDisplay";
import { type RepoOption } from "./codeBrowseShared";

const PAGE_SIZE = 50;

// Right pane when the user runs a full-text search from the box above the tree.
// Scopes the existing code search to the current repository and branch; each hit
// can be expanded to preview the matching lines, and clicking it opens the file.
// Results page in with "Load more", and an optional path filter narrows the scope.
export function CodeSearchResults({
  organizationId,
  repo,
  branch,
  query,
  onOpenFile,
  onClose,
}: {
  organizationId: string;
  repo: RepoOption;
  branch: string;
  query: string;
  onOpenFile: (path: string) => void;
  onClose: () => void;
}) {
  const [pathFilter, setPathFilter] = useState("");
  // Avoid issuing a fresh search on every keystroke in the path filter.
  const deferredPath = useDeferredValue(pathFilter.trim());

  const search = useInfiniteQuery({
    queryKey: ["repoCodeSearch", organizationId, repo.repositoryId, branch, query, deferredPath],
    queryFn: ({ pageParam }) =>
      searchCode({
        organizationId,
        query,
        projects: [repo.projectName],
        repositories: [repo.repositoryName],
        branch,
        path: deferredPath || undefined,
        top: PAGE_SIZE,
        skip: pageParam,
      }),
    enabled: !!query.trim(),
    staleTime: 60_000,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.results.length, 0);
      // Stop when the last page came up short or we've reached the total count.
      if (lastPage.results.length < PAGE_SIZE || loaded >= lastPage.count) return undefined;
      return loaded;
    },
  });

  const pages = search.data?.pages ?? [];
  const results = pages.flatMap((page) => page.results);
  const count = pages[0]?.count ?? 0;
  const notice = pages[0]?.notice ?? null;

  // Move focus into the result list once results arrive so keyboard users land
  // in the pane rather than being stranded on the search box.
  const listRef = useRef<HTMLUListElement | null>(null);
  useEffect(() => {
    if (results.length > 0) {
      listRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }
    // Only react to the first batch arriving, not every "load more".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.length > 0]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-sm">
        <span className="text-muted-foreground">
          {search.isPending
            ? "Searching…"
            : search.data
              ? `${count} match${count === 1 ? "" : "es"} for “${query}”`
              : ""}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          aria-label="Close search results"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" /> Close
        </button>
      </div>
      <div className="border-b border-border px-3 py-1.5">
        <input
          type="text"
          value={pathFilter}
          onChange={(event) => setPathFilter(event.target.value)}
          placeholder="Filter by path (e.g. src/components)"
          aria-label="Filter results by path"
          className="h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      {notice ? (
        <div
          role="status"
          className="border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
        >
          {notice}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {search.isLoading ? (
          <div className="flex items-center gap-1.5 px-3 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Searching…
          </div>
        ) : search.isError ? (
          <ErrorState message={commandErrorMessage(search.error)} />
        ) : results.length === 0 ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">
            {notice ? "No code matched yet." : "No code matched."}
          </div>
        ) : (
          <>
            <ul ref={listRef}>
              {results.map((hit) => (
                <CodeSearchHitRow
                  key={`${hit.path}:${hit.branch ?? ""}`}
                  organizationId={organizationId}
                  hit={hit}
                  searchBranch={branch}
                  query={query}
                  onOpenFile={onOpenFile}
                />
              ))}
            </ul>
            {search.hasNextPage ? (
              <div className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => search.fetchNextPage()}
                  disabled={search.isFetchingNextPage}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-input py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  {search.isFetchingNextPage ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading…
                    </>
                  ) : (
                    `Load more (${results.length} of ${count})`
                  )}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

// A single search hit: the file name/path opens the file; the chevron toggles a
// lazily-loaded preview of the matching lines with surrounding context.
function CodeSearchHitRow({
  organizationId,
  hit,
  searchBranch,
  query,
  onOpenFile,
}: {
  organizationId: string;
  hit: CodeSearchHit;
  searchBranch: string;
  query: string;
  onOpenFile: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const branch = hit.branch || searchBranch;
  const context = useQuery({
    queryKey: ["codeSearchContext", organizationId, hit.repositoryName, branch, hit.path, query],
    queryFn: () =>
      getCodeSearchContext({
        organizationId,
        project: hit.projectName,
        repository: hit.repositoryName,
        branch,
        path: hit.path,
        query,
      }),
    enabled: expanded,
    staleTime: 60_000,
  });

  return (
    <li className="border-b border-border/60">
      <div className="flex w-full min-w-0 items-stretch">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide matches" : "Show matches"}
          className="flex shrink-0 items-center px-1.5 text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={() => onOpenFile(hit.path)}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-3 text-left text-sm hover:bg-muted/50"
          title={hit.path}
        >
          <FileCode className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="shrink-0 font-medium">{hit.fileName}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            {hit.path}
          </span>
        </button>
      </div>
      {expanded ? (
        <div className="border-t border-border/40 bg-muted/20 px-2 py-1.5">
          {context.isLoading ? (
            <div className="flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading matches…
            </div>
          ) : context.isError ? (
            <div className="px-1 py-1 text-xs text-destructive">
              {commandErrorMessage(context.error)}
            </div>
          ) : !context.data || context.data.blocks.length === 0 ? (
            <div className="px-1 py-1 text-xs text-muted-foreground">No preview available.</div>
          ) : (
            <div className="space-y-1.5">
              {context.data.blocks.map((block, blockIndex) => (
                <pre
                  key={blockIndex}
                  className="overflow-x-auto rounded bg-background/60 font-mono text-[11px] leading-4"
                >
                  <code>
                    {block.lines.map((line) => (
                      <div
                        key={line.lineNumber}
                        className={line.isMatch ? "bg-amber-200/40" : undefined}
                      >
                        <span className="mr-2 inline-block w-10 shrink-0 select-none text-right text-muted-foreground">
                          {line.lineNumber}
                        </span>
                        {line.isMatch ? highlightQuery(line.text, query) : line.text || " "}
                      </div>
                    ))}
                  </code>
                </pre>
              ))}
              {context.data.truncated ? (
                <div className="px-1 text-[11px] text-muted-foreground">
                  Showing the first {context.data.blocks.length} of {context.data.totalMatches}{" "}
                  matches — open the file to see the rest.
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

// Wraps each (case-insensitive) occurrence of the query in the line with <mark>.
function highlightQuery(text: string, query: string): ReactNode {
  const needle = query.toLowerCase();
  if (!needle) return text || " ";
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (;;) {
    const at = lower.indexOf(needle, cursor);
    if (at < 0) {
      parts.push(text.slice(cursor));
      break;
    }
    if (at > cursor) parts.push(text.slice(cursor, at));
    parts.push(
      <mark key={key++} className="bg-amber-300 text-black">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    cursor = at + needle.length;
  }
  return parts;
}
