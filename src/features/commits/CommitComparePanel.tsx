import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Maximize2, Minimize2, X } from "lucide-react";
import {
  type CommitSummary,
  commandErrorMessage,
  getCommitFileDiff,
  getCommitRangeChanges,
} from "@/lib/azdoCommands";
import { isEditableTarget, focusPrimaryGrid } from "@/lib/utils";
import { changeTypeBadge, fileName } from "./CommitFilesPanel";
import { FileDiffView } from "@/components/FileDiffView";

/**
 * Two-commit compare view: shown instead of the normal single-commit preview
 * once two commits are marked for compare in the grid (see CommitResults).
 * Reuses the same changed-file badges/diff rendering as CommitFilesPanel, just
 * fed from `getCommitRangeChanges` (base/target, not commit/parent).
 */
export function CommitComparePanel({
  base,
  target,
  maximized,
  onToggleMaximize,
  onClear,
}: {
  base: CommitSummary;
  target: CommitSummary;
  maximized: boolean;
  onToggleMaximize: () => void;
  onClear: () => void;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const sameRepository =
    base.organizationId === target.organizationId && base.repositoryId === target.repositoryId;

  // Esc / ← step back to the grid (mirrors CommitPreviewPanel's convention).
  function handleKeyDown(event: ReactKeyboardEvent) {
    if (isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusPrimaryGrid();
    }
  }

  function handleClear() {
    onClear();
    // Clearing removes this panel from the DOM; return focus to the grid
    // instead of letting it fall back to <body>.
    focusPrimaryGrid();
  }

  const changesQuery = useQuery({
    queryKey: [
      "commitRangeChanges",
      base.organizationId,
      base.projectId,
      base.repositoryId,
      base.commitId,
      target.commitId,
    ],
    queryFn: () =>
      getCommitRangeChanges({
        organizationId: base.organizationId,
        projectId: base.projectId,
        repositoryId: base.repositoryId,
        baseCommitId: base.commitId,
        targetCommitId: target.commitId,
      }),
    enabled: sameRepository,
    staleTime: 5 * 60_000,
  });

  const files = changesQuery.data?.files ?? [];
  const selectedFile = files.find((file) => file.path === selectedPath) ?? null;

  const diffQuery = useQuery({
    queryKey: [
      "commitRangeFileDiff",
      base.organizationId,
      base.repositoryId,
      base.commitId,
      target.commitId,
      selectedPath,
    ],
    queryFn: () =>
      getCommitFileDiff({
        organizationId: base.organizationId,
        projectId: base.projectId,
        repositoryId: base.repositoryId,
        // Reuse the single-commit diff command for content at two arbitrary
        // commits: target -> commitId, base -> parentCommitId. Keeping this
        // orientation consistent with getCommitRangeChanges' base/target
        // order is what keeps add/delete sides from inverting.
        commitId: target.commitId,
        parentCommitId: base.commitId,
        filePath: (selectedFile as NonNullable<typeof selectedFile>).path,
        originalPath: selectedFile?.originalPath ?? null,
        changeType: selectedFile?.changeType ?? "edit",
      }),
    enabled: !!selectedFile,
    staleTime: 5 * 60_000,
  });

  return (
    <aside
      onKeyDown={handleKeyDown}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card focus-within:ring-2 focus-within:ring-ring"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">Compare</span>
        <span className="truncate font-mono text-xs" title={base.commitId}>
          {base.shortCommitId}
        </span>
        <span className="text-muted-foreground" aria-hidden="true">
          →
        </span>
        <span className="truncate font-mono text-xs" title={target.commitId}>
          {target.shortCommitId}
        </span>
        <button
          type="button"
          onClick={handleClear}
          title="Clear compare selection (Esc on the grid)"
          className="ml-auto shrink-0 rounded border border-border bg-card px-1.5 py-px text-[11px] text-muted-foreground hover:bg-secondary"
        >
          <X className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">Clear compare selection</span>
        </button>
        <button
          type="button"
          onClick={onToggleMaximize}
          aria-pressed={maximized}
          aria-label={maximized ? "Restore split view" : "Maximize preview"}
          title={`${maximized ? "Restore split view" : "Maximize preview"} (\\)`}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {maximized ? (
            <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto outline-none"
        data-primary-preview="true"
        aria-keyshortcuts="Control+P"
        tabIndex={-1}
      >
        {!sameRepository ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            Select two commits from the same repository to compare.
          </p>
        ) : changesQuery.isLoading ? (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading changed
            files…
          </div>
        ) : changesQuery.isError ? (
          <p className="px-3 py-3 text-xs text-destructive">
            {commandErrorMessage(changesQuery.error)}
          </p>
        ) : files.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">No changed files.</p>
        ) : (
          <div>
            <div className="border-b border-border bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
              {files.length} changed file{files.length === 1 ? "" : "s"}
            </div>
            <ul>
              {files.map((file) => {
                const badge = changeTypeBadge(file.changeType);
                const selected = file.path === selectedPath;
                return (
                  <li key={file.path}>
                    <button
                      type="button"
                      onClick={() => setSelectedPath(selected ? null : file.path)}
                      className={`flex w-full min-w-0 items-center gap-1.5 px-3 py-1 text-left text-xs ${
                        selected ? "bg-secondary" : "hover:bg-muted/50"
                      }`}
                      title={file.path}
                    >
                      <span
                        className={`inline-flex w-4 shrink-0 items-center justify-center rounded border text-[10px] font-semibold ${badge.cls}`}
                        aria-label={file.changeType}
                      >
                        {badge.label}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono">
                        {fileName(file.path)}
                      </span>
                    </button>
                    {selected ? (
                      <div className="border-y border-border">
                        {diffQuery.isLoading ? (
                          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{" "}
                            Loading diff…
                          </div>
                        ) : diffQuery.isError ? (
                          <p className="px-3 py-2 text-xs text-destructive">
                            {commandErrorMessage(diffQuery.error)}
                          </p>
                        ) : diffQuery.data ? (
                          <FileDiffView
                            baseContent={diffQuery.data.baseContent}
                            targetContent={diffQuery.data.targetContent}
                            baseUnavailableReason={diffQuery.data.baseUnavailableReason}
                            targetUnavailableReason={diffQuery.data.targetUnavailableReason}
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}
