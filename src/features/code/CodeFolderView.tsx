import { type KeyboardEvent as ReactKeyboardEvent, useRef } from "react";
import { File as FileIcon, Folder as FolderIcon, Loader2 } from "lucide-react";
import { commandErrorMessage, type Organization } from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { MarkdownView } from "@/lib/markdown";
import { ErrorState } from "@/components/StateDisplay";
import { useGridVirtualizer } from "@/lib/useGridVirtualizer";
import {
  commitUrl,
  formatDate,
  handleRowNavKey,
  useRepoFile,
  useTreeQuery,
  type RepoOption,
} from "./codeBrowseShared";

// Folders larger than this window their rows instead of rendering them all.
const VIRTUALIZE_THRESHOLD = 300;
// Fixed row height (h-8) the windowing math relies on.
const ROW_HEIGHT = 32;

// Right pane when a folder is selected: the Azure DevOps folder listing with
// Name / Last change / Last commit columns, plus the folder's README rendered below.
export function CodeFolderView({
  organization,
  organizationId,
  repo,
  branch,
  path,
  onOpenFolder,
  onOpenFile,
}: {
  organization: Organization | undefined;
  organizationId: string;
  repo: RepoOption;
  branch: string;
  path: string;
  onOpenFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const query = useTreeQuery(organizationId, repo, branch, path, true);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const allItems = query.data ?? [];
  // Very large folders window their rows with the shared grid virtualizer;
  // small ones render everything (keeps the README directly below the table).
  const virtualize = allItems.length > VIRTUALIZE_THRESHOLD;
  const virtualizer = useGridVirtualizer({
    rowCount: allItems.length,
    rowHeight: ROW_HEIGHT,
    overscan: 10,
  });

  // Arrow keys (or J/K) move focus between rows; Enter/Space (native button
  // activation) opens the focused entry, matching the Commits grid.
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    handleRowNavKey(event, containerRef.current, "[data-folder-item]");
  }

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  }
  if (query.isError) {
    return <ErrorState message={commandErrorMessage(query.error)} />;
  }
  if (allItems.length === 0) {
    return <div className="px-3 py-3 text-sm text-muted-foreground">This folder is empty.</div>;
  }

  const readme = allItems.find((item) => !item.isFolder && /^readme\.md$/i.test(item.name));
  const items = virtualize
    ? allItems.slice(virtualizer.firstRow, virtualizer.lastRow)
    : allItems;

  return (
    <div
      ref={(node) => {
        containerRef.current = node;
        if (virtualize) virtualizer.scrollerRef(node);
      }}
      onKeyDown={onKeyDown}
      className={virtualize ? "h-full overflow-y-auto" : undefined}
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-3 py-1.5 font-medium">Name</th>
            <th className="px-3 py-1.5 font-medium">Last change</th>
            <th className="px-3 py-1.5 font-medium">Last commit</th>
          </tr>
        </thead>
        <tbody>
          {virtualize && virtualizer.topPadding > 0 ? (
            <tr style={{ height: virtualizer.topPadding }} aria-hidden="true" />
          ) : null}
          {items.map((item) => (
            <tr key={item.path} className="h-8 border-b border-border/60 hover:bg-muted/50">
              <td className="px-3 py-1.5">
                <button
                  type="button"
                  data-folder-item
                  onClick={() => (item.isFolder ? onOpenFolder(item.path) : onOpenFile(item.path))}
                  className="flex items-center gap-2 text-left"
                >
                  {item.isFolder ? (
                    <FolderIcon
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : (
                    <FileIcon
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <span className="whitespace-nowrap">{item.name}</span>
                </button>
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                {formatDate(item.lastCommit?.date)}
              </td>
              <td className="px-3 py-1.5">
                {item.lastCommit ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        openExternalUrl(commitUrl(organization, repo, item.lastCommit!.commitId))
                      }
                      className="shrink-0 font-mono text-xs text-primary hover:underline"
                      title="Open commit in Azure DevOps"
                    >
                      {item.lastCommit.shortId}
                    </button>
                    <span className="truncate text-muted-foreground">
                      {item.lastCommit.message}
                      {item.lastCommit.author ? (
                        <span className="ml-1 text-xs">{item.lastCommit.author}</span>
                      ) : null}
                    </span>
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
          {virtualize && virtualizer.bottomPadding > 0 ? (
            <tr style={{ height: virtualizer.bottomPadding }} aria-hidden="true" />
          ) : null}
        </tbody>
      </table>
      {readme ? (
        <ReadmePreview
          organizationId={organizationId}
          repo={repo}
          branch={branch}
          path={readme.path}
        />
      ) : null}
    </div>
  );
}

// Renders a folder's README.md as formatted markdown below the file listing,
// matching the Azure DevOps Files view.
function ReadmePreview({
  organizationId,
  repo,
  branch,
  path,
}: {
  organizationId: string;
  repo: RepoOption;
  branch: string;
  path: string;
}) {
  const query = useRepoFile(organizationId, repo, branch, path);
  const file = query.data;
  if (!file || file.isBinary || file.tooLarge || !file.content.trim()) return null;
  return (
    <div className="m-3 rounded-md border border-border p-4">
      <MarkdownView text={file.content} />
    </div>
  );
}
