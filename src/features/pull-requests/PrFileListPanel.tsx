import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import type { PrChangedFile } from "@/lib/azdoCommands";
import { changeTypeBadge, pathKey, type FileTreeRow } from "./PrFilesTabTypes";

export function PrFileListPanel({
  files,
  fileTreeRows,
  selectedPath,
  viewedKeys,
  fileViewedKey,
  viewedCount,
  activeThreadCounts,
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
          <span className="text-muted-foreground/70" title="j/k move files · v toggle viewed · n/p jump comments">
            j/k · v · n/p
          </span>
        </div>
      </div>
      <div ref={fileListRef} className="min-h-0 flex-1 overflow-y-auto">
        {fileTreeRows.map((row) => {
          if (row.kind === "folder") {
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
                <span className="truncate font-mono">{row.name}</span>
              </button>
            );
          }
          const file = row.file;
          const badge = changeTypeBadge(file.changeType);
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
                className={`inline-flex w-4 shrink-0 items-center justify-center rounded border text-[10px] font-semibold ${badge.cls}`}
                aria-label={file.changeType}
              >
                {badge.label}
              </span>
              <span
                className={`min-w-0 flex-1 truncate font-mono ${viewed ? "line-through" : ""}`}
              >
                {row.name}
              </span>
              {threadCount > 0 ? (
                <span className="inline-flex shrink-0 items-center rounded-full border border-blue-200 bg-blue-50 px-1.5 text-[10px] font-medium text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
                  {threadCount}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
