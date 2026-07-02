import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import type { PrChangedFile } from "@/lib/azdoCommands";
import { focusPrimaryPreview } from "@/lib/utils";
import { changeTypeMarker, pathKey, type FileTreeRow } from "./PrFilesTabTypes";

/** Sum of unresolved-thread counts for every file under a collapsed folder,
 * matched by path prefix so nested subfolders roll up too. */
function folderThreadCount(
  folderPath: string,
  files: PrChangedFile[],
  activeThreadCounts: Map<string, number>,
): number {
  const prefix = `${pathKey(folderPath)}/`;
  let total = 0;
  for (const file of files) {
    if (pathKey(file.path).startsWith(prefix)) {
      total += activeThreadCounts.get(pathKey(file.path)) ?? 0;
    }
  }
  return total;
}

function ThreadCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-blue-200 bg-blue-50 px-1.5 text-[10px] font-medium text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
      {count}
    </span>
  );
}

export function PrFileListPanel({
  files,
  fileTreeRows,
  selectedPath,
  viewedKeys,
  fileViewedKey,
  viewedCount,
  activeThreadCounts,
  filterQuery,
  onFilterQueryChange,
  onSelectFile,
  onToggleFolder,
  onSetAllViewed,
  fileListRef,
}: {
  files: PrChangedFile[];
  fileTreeRows: FileTreeRow[];
  selectedPath: string | null;
  viewedKeys: Set<string>;
  fileViewedKey: (path: string) => string;
  viewedCount: number;
  activeThreadCounts: Map<string, number>;
  filterQuery: string;
  onFilterQueryChange: (query: string) => void;
  onSelectFile: (path: string) => void;
  onToggleFolder: (path: string) => void;
  onSetAllViewed: (viewed: boolean) => void;
  fileListRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex w-2/5 min-w-[150px] max-w-[340px] shrink-0 flex-col border-r border-border">
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted px-2 py-1 text-[11px] text-muted-foreground">
        <span>
          {files.length} file{files.length === 1 ? "" : "s"} ·{" "}
          <span className={viewedCount === files.length ? "font-medium text-green-700 dark:text-green-400" : ""}>
            {viewedCount}/{files.length} viewed
          </span>
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSetAllViewed(viewedCount < files.length)}
            title={
              viewedCount < files.length
                ? "Mark every file as viewed"
                : "Clear viewed on every file"
            }
            className="rounded px-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            {viewedCount < files.length ? "Mark all" : "Clear all"}
          </button>
          <span
            className="text-muted-foreground/70"
            title="j/k move files · v toggle viewed · n/p jump comments · [/] jump changed blocks"
          >
            j/k · v · n/p · [/]
          </span>
        </div>
      </div>
      <div className="shrink-0 border-b border-border px-2 py-1">
        <input
          type="text"
          role="searchbox"
          aria-label="Filter files"
          placeholder="Filter files…"
          value={filterQuery}
          onChange={(event) => onFilterQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onFilterQueryChange("");
              focusPrimaryPreview();
            }
          }}
          data-filter-input="true"
          className="w-full rounded border border-border bg-card px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div ref={fileListRef} className="min-h-0 flex-1 overflow-y-auto">
        {fileTreeRows.map((row) => {
          if (row.kind === "folder") {
            const threadCount = row.collapsed
              ? folderThreadCount(row.path, files, activeThreadCounts)
              : 0;
            return (
              <button
                key={`folder:${row.path}`}
                type="button"
                onClick={() => onToggleFolder(row.path)}
                aria-expanded={!row.collapsed}
                className="flex w-full items-center gap-1 py-1 pr-2 text-left text-xs text-muted-foreground hover:bg-muted/50"
                style={{ paddingLeft: 8 + row.depth * 12 }}
                title={row.path}
              >
                {row.collapsed ? (
                  <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
                )}
                <Folder className="h-3 w-3 shrink-0 text-muted-foreground/70" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-mono">{row.name}</span>
                <ThreadCountBadge count={threadCount} />
              </button>
            );
          }
          const file = row.file;
          const marker = changeTypeMarker(file.changeType);
          const threadCount = activeThreadCounts.get(pathKey(file.path)) ?? 0;
          const selected = file.path === selectedPath;
          const viewed = viewedKeys.has(fileViewedKey(file.path));
          return (
            <div
              key={file.path}
              role="button"
              tabIndex={-1}
              onClick={() => onSelectFile(file.path)}
              className={`flex w-full cursor-pointer items-center gap-1.5 py-1 pr-2 text-left text-xs ${
                selected ? "bg-secondary" : "hover:bg-muted/50"
              } ${viewed ? "opacity-55" : ""}`}
              style={{ paddingLeft: 8 + row.depth * 12 + 4 }}
              title={file.path}
            >
              <span
                className={`w-3 shrink-0 text-center text-[11px] font-semibold ${marker?.cls ?? ""}`}
                aria-label={marker ? `${marker.label} change` : "edited"}
              >
                {marker?.symbol ?? ""}
              </span>
              <span
                className={`min-w-0 flex-1 truncate font-mono ${viewed ? "line-through" : ""}`}
              >
                {row.name}
              </span>
              <ThreadCountBadge count={threadCount} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
