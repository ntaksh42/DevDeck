import { useQuery } from "@tanstack/react-query";
import { File as FileIcon, Folder as FolderIcon, Loader2 } from "lucide-react";
import { commandErrorMessage, listRepoPaths } from "@/lib/azdoCommands";
import { ErrorState } from "@/components/StateDisplay";
import { type RepoOption } from "./codeBrowseShared";

// Keep the filtered list light: matches beyond this are counted, not rendered.
const MAX_VISIBLE_MATCHES = 500;

// Replaces the lazy tree while the filter box has text: matches file/folder
// paths across the whole repository (one recursive listing, cached per
// branch), so hits inside unexpanded folders are found too. Rows carry the
// same data attributes as tree rows, so the container's keyboard navigation
// keeps working.
export function CodeFilteredTree({
  organizationId,
  repo,
  branch,
  filterText,
  selectedPath,
  onOpenFolder,
  onOpenFile,
}: {
  organizationId: string;
  repo: RepoOption;
  branch: string;
  filterText: string;
  selectedPath: string;
  onOpenFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const query = useQuery({
    queryKey: ["repoPaths", organizationId, repo.repositoryId, branch],
    queryFn: () =>
      listRepoPaths({
        organizationId,
        project: repo.projectId,
        repository: repo.repositoryId,
        branch,
      }),
    enabled: !!branch,
    staleTime: 60_000,
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  }
  if (query.isError) {
    return <ErrorState message={commandErrorMessage(query.error)} />;
  }

  const needle = filterText.trim().toLowerCase();
  const matches = (query.data?.items ?? []).filter((item) =>
    item.path.toLowerCase().includes(needle),
  );
  const visible = matches.slice(0, MAX_VISIBLE_MATCHES);
  const hiddenCount = matches.length - visible.length;

  return (
    <ul role="group">
      {visible.map((item) => (
        <li key={item.path} role="treeitem">
          <button
            type="button"
            data-tree-item
            data-path={item.path}
            data-folder={item.isFolder ? "true" : "false"}
            tabIndex={-1}
            onClick={() => (item.isFolder ? onOpenFolder(item.path) : onOpenFile(item.path))}
            title={item.path}
            className={`flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              item.path === selectedPath ? "bg-secondary" : "hover:bg-muted/50"
            }`}
          >
            {item.isFolder ? (
              <FolderIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
              <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="shrink-0">{item.name}</span>
            <span className="truncate text-xs text-muted-foreground">{item.path}</span>
          </button>
        </li>
      ))}
      {matches.length === 0 ? (
        <li className="px-2 py-1 text-xs text-muted-foreground">No matches</li>
      ) : null}
      {hiddenCount > 0 || query.data?.truncated ? (
        <li className="px-2 py-1 text-xs text-muted-foreground">
          Showing {visible.length} of {matches.length}
          {query.data?.truncated ? "+" : ""} matches — refine the filter to narrow down.
        </li>
      ) : null}
    </ul>
  );
}
