import { ChevronRight, File as FileIcon, Folder as FolderIcon, Loader2 } from "lucide-react";
import { commandErrorMessage } from "@/lib/azdoCommands";
import { useTreeQuery, type RepoOption } from "./codeBrowseShared";

export type TreeProps = {
  organizationId: string;
  repo: RepoOption;
  branch: string;
  parentPath: string;
  depth: number;
  selectedPath: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
};

// One level of the file tree: fetches the children of `parentPath` and renders
// each, recursing into expanded folders so each level loads lazily on demand.
// Rows carry data attributes so the container can drive keyboard navigation.
// (Filtering is handled by CodeFilteredTree, which swaps in for the tree.)
export function TreeLevel({
  organizationId,
  repo,
  branch,
  parentPath,
  depth,
  selectedPath,
  expanded,
  onToggle,
  onOpenFolder,
  onOpenFile,
}: TreeProps) {
  const query = useTreeQuery(organizationId, repo, branch, parentPath, false);
  const items = query.data ?? [];

  if (query.isLoading) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground"
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  }
  if (query.isError) {
    return (
      <p className="px-2 py-1 text-xs text-destructive" style={{ paddingLeft: depth * 12 + 8 }}>
        {commandErrorMessage(query.error)}
      </p>
    );
  }

  return (
    <ul role="group">
      {items.map((item) => {
        const isOpen = expanded.has(item.path);
        return (
          <li key={item.path} role="treeitem" aria-expanded={item.isFolder ? isOpen : undefined}>
            <div
              className={`flex items-center gap-1 pr-2 text-sm ${
                item.path === selectedPath ? "bg-secondary" : "hover:bg-muted/50"
              }`}
              style={{ paddingLeft: depth * 12 }}
            >
              <button
                type="button"
                onClick={() => (item.isFolder ? onToggle(item.path) : undefined)}
                tabIndex={-1}
                className={`flex h-7 w-5 items-center justify-center text-muted-foreground ${
                  item.isFolder ? "hover:text-foreground" : "invisible"
                }`}
                aria-label={isOpen ? "Collapse folder" : "Expand folder"}
              >
                <ChevronRight
                  className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                data-tree-item
                data-path={item.path}
                data-folder={item.isFolder ? "true" : "false"}
                data-open={isOpen ? "true" : "false"}
                tabIndex={-1}
                onClick={() => (item.isFolder ? onOpenFolder(item.path) : onOpenFile(item.path))}
                className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {item.isFolder ? (
                  <FolderIcon
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                ) : (
                  <FileIcon
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <span className="truncate">{item.name}</span>
              </button>
            </div>
            {item.isFolder && isOpen ? (
              <TreeLevel
                organizationId={organizationId}
                repo={repo}
                branch={branch}
                parentPath={item.path}
                depth={depth + 1}
                selectedPath={selectedPath}
                expanded={expanded}
                onToggle={onToggle}
                onOpenFolder={onOpenFolder}
                onOpenFile={onOpenFile}
              />
            ) : null}
          </li>
        );
      })}
      {items.length === 0 ? (
        <li
          className="px-2 py-1 text-xs text-muted-foreground"
          style={{ paddingLeft: depth * 12 + 8 }}
        >
          Empty
        </li>
      ) : null}
    </ul>
  );
}
