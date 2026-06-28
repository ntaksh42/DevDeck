import { useQuery } from "@tanstack/react-query";
import { FileCode, Loader2, X } from "lucide-react";
import { commandErrorMessage, searchCode } from "@/lib/azdoCommands";
import { ErrorState } from "@/components/StateDisplay";
import { type RepoOption } from "./codeBrowseShared";

// Right pane when the user runs a full-text search from the box above the tree.
// Scopes the existing code search to the current repository and branch; clicking
// a hit opens that file back in the browse pane.
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
  const search = useQuery({
    queryKey: ["repoCodeSearch", organizationId, repo.repositoryId, branch, query],
    queryFn: () =>
      searchCode({
        organizationId,
        query,
        projects: [repo.projectName],
        repositories: [repo.repositoryName],
        branch,
      }),
    enabled: !!query.trim(),
    staleTime: 60_000,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-sm">
        <span className="text-muted-foreground">
          {search.isPending
            ? "Searching…"
            : search.data
              ? `${search.data.count} match${search.data.count === 1 ? "" : "es"} for “${query}”`
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        {search.isLoading ? (
          <div className="flex items-center gap-1.5 px-3 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Searching…
          </div>
        ) : search.isError ? (
          <ErrorState message={commandErrorMessage(search.error)} />
        ) : !search.data || search.data.results.length === 0 ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">No code matched.</div>
        ) : (
          <ul>
            {search.data.results.map((hit) => (
              <li key={`${hit.path}:${hit.branch ?? ""}`} className="border-b border-border/60">
                <button
                  type="button"
                  onClick={() => onOpenFile(hit.path)}
                  className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/50"
                  title={hit.path}
                >
                  <FileCode className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="shrink-0 font-medium">{hit.fileName}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                    {hit.path}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
