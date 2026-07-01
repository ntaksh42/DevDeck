import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ExternalLink, GitMerge, Loader2 } from "lucide-react";
import {
  commandErrorMessage,
  getCommitChanges,
  getCommitFileDiff,
  type CommitFileDiff,
} from "@/lib/azdoCommands";
import { summarizeDiff, type DiffSummary } from "@/lib/diffView";
import { isEditableTarget } from "@/lib/utils";
import { openExternalUrl } from "@/lib/openExternal";
import { CommitDiffView } from "./CommitDiffView";

type ChangeBadge = { label: string; cls: string };
const ADD_BADGE: ChangeBadge = { label: "A", cls: "border-green-200 bg-green-100 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300" };
const DELETE_BADGE: ChangeBadge = { label: "D", cls: "border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300" };
const RENAME_BADGE: ChangeBadge = {
  label: "R",
  cls: "border-purple-200 bg-purple-100 text-purple-800 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-300",
};
const EDIT_BADGE: ChangeBadge = { label: "M", cls: "border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300" };

function changeTypeBadge(changeType: string): ChangeBadge {
  const tokens = changeType.toLowerCase().split(",").map((token) => token.trim());
  if (tokens.includes("rename")) return RENAME_BADGE;
  if (tokens.includes("delete")) return DELETE_BADGE;
  if (tokens.includes("add") || tokens.includes("undelete")) return ADD_BADGE;
  return EDIT_BADGE;
}

function fileName(path: string): string {
  return path.replace(/^\/+/, "").split("/").pop() ?? path;
}

/** Deep-links to a file's diff on the Azure DevOps commit page. The commit web
 * URL already targets the correct org/project/repo/commit; appending `?path=`
 * focuses that file, matching how the web UI links into a commit. */
function fileDiffUrl(commitWebUrl: string, path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${commitWebUrl}?path=${encodeURIComponent(normalized)}`;
}

// A file with both sides unavailable (binary, too large, missing) has no
// meaningful +/- count; everything else diffs as text, including one-sided
// adds/deletes (the missing side is just empty, not "unavailable").
function diffStats(diff: CommitFileDiff | undefined): DiffSummary | null {
  if (!diff) return null;
  if (diff.baseUnavailableReason && diff.targetUnavailableReason) return null;
  const baseText = diff.baseUnavailableReason ? "" : diff.baseContent ?? "";
  const targetText = diff.targetUnavailableReason ? "" : diff.targetContent ?? "";
  return summarizeDiff(baseText, targetText);
}

function fileDiffQueryKey(
  organizationId: string,
  projectId: string,
  repositoryId: string,
  commitId: string,
  parentCommitId: string | null,
  filePath: string,
) {
  return [
    "commitFileDiff",
    organizationId,
    projectId,
    repositoryId,
    commitId,
    parentCommitId,
    filePath,
  ] as const;
}

export function CommitFilesPanel({
  organizationId,
  projectId,
  repositoryId,
  commitId,
  commitWebUrl = null,
}: {
  organizationId: string;
  projectId: string;
  repositoryId: string;
  commitId: string;
  commitWebUrl?: string | null;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // `null` defers to the first (default) parent once `changes` loads; set
  // once the user picks a different parent from the merge-commit selector.
  const [explicitParent, setExplicitParent] = useState<string | null>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const restoreFocusRef = useRef(false);
  const hunkStopRef = useRef(0);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const changesQuery = useQuery({
    queryKey: [
      "commitChanges",
      organizationId,
      projectId,
      repositoryId,
      commitId,
      explicitParent,
    ],
    queryFn: () =>
      getCommitChanges({
        organizationId,
        projectId,
        repositoryId,
        commitId,
        baseCommitId: explicitParent,
      }),
    staleTime: 5 * 60_000,
  });

  const changes = changesQuery.data ?? null;
  const files = changes?.files ?? [];
  const parents = changes?.parents ?? [];
  const effectiveParent = explicitParent ?? parents[0] ?? null;

  // Fetches every changed file's diff eagerly so the list can show per-file
  // +/- counts and a commit-wide summary. The selected file's inline diff
  // view (below) reads from this same array/cache key instead of issuing a
  // second request.
  const diffQueries = useQueries({
    queries: files.map((file) => ({
      queryKey: fileDiffQueryKey(
        organizationId,
        projectId,
        repositoryId,
        commitId,
        effectiveParent,
        file.path,
      ),
      queryFn: () =>
        getCommitFileDiff({
          organizationId,
          projectId,
          repositoryId,
          commitId,
          parentCommitId: effectiveParent,
          filePath: file.path,
          originalPath: file.originalPath ?? null,
          changeType: file.changeType,
        }),
      enabled: !!changes,
      staleTime: 5 * 60_000,
    })),
  });

  const totals = diffQueries.reduce<DiffSummary>(
    (sum, q) => {
      const stats = diffStats(q.data);
      return stats
        ? { additions: sum.additions + stats.additions, deletions: sum.deletions + stats.deletions }
        : sum;
    },
    { additions: 0, deletions: 0 },
  );

  const selectedIndex = files.findIndex((file) => file.path === selectedPath);
  const selectedDiff = selectedIndex >= 0 ? diffQueries[selectedIndex] : null;

  // Rows outside the virtual-free, always-mounted list stay in the DOM, so
  // roving focus just needs to follow the new selection directly.
  useEffect(() => {
    if (!restoreFocusRef.current) return;
    const row = selectedIndex >= 0 ? rowRefs.current[selectedIndex] : null;
    restoreFocusRef.current = false;
    row?.focus({ preventScroll: true });
  });

  // A parent switch (or a new commit) invalidates which hunk n/p last
  // stopped at.
  useEffect(() => {
    hunkStopRef.current = 0;
  }, [selectedPath]);

  function selectFileAtIndex(index: number) {
    if (files.length === 0) return;
    const clamped = Math.max(0, Math.min(files.length - 1, index));
    restoreFocusRef.current = true;
    setSelectedPath(files[clamped].path);
  }

  function handleKeyDown(event: ReactKeyboardEvent) {
    if (isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "j" || event.key === "J" || event.key === "ArrowDown") {
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      selectFileAtIndex(selectedIndex < 0 ? 0 : selectedIndex + 1);
      return;
    }
    if (event.key === "k" || event.key === "K" || event.key === "ArrowUp") {
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      selectFileAtIndex(selectedIndex < 0 ? files.length - 1 : selectedIndex - 1);
      return;
    }
    // Jumps between diff hunks (and collapsed-region expand buttons) in the
    // currently open file's diff. Scroll-only: focus stays on the file row,
    // so Escape/ArrowLeft still bubble up to return focus to the grid.
    if (event.key === "n" || event.key === "p") {
      const stops = panelRef.current?.querySelectorAll<HTMLElement>("[data-hunk='true']");
      if (!stops || stops.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = event.key === "n" ? 1 : -1;
      hunkStopRef.current = Math.max(0, Math.min(stops.length - 1, hunkStopRef.current + delta));
      stops[hunkStopRef.current]?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      return;
    }
    // Expands the collapsed-region button n/p last stopped at (a no-op on a
    // hunk stop, which is not a button). There is no re-collapse shortcut
    // because the mouse path is expand-only too.
    if (event.key === "x") {
      const stops = panelRef.current?.querySelectorAll<HTMLElement>("[data-hunk='true']");
      const current = stops?.[hunkStopRef.current];
      if (!(current instanceof HTMLButtonElement)) return;
      event.preventDefault();
      event.stopPropagation();
      current.click();
    }
  }

  if (changesQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading changed files…
      </div>
    );
  }
  if (changesQuery.isError) {
    return (
      <p className="px-3 py-3 text-xs text-destructive">
        {commandErrorMessage(changesQuery.error)}
      </p>
    );
  }
  if (files.length === 0) {
    return <p className="px-3 py-3 text-xs text-muted-foreground">No changed files.</p>;
  }

  // The tab stop follows the open file, defaulting to the first row so the
  // list is always reachable by Tab even before anything is selected.
  const tabStopIndex = selectedIndex >= 0 ? selectedIndex : 0;

  return (
    <div ref={panelRef} className="border-t border-border" onKeyDown={handleKeyDown}>
      <div className="flex items-center gap-2 border-b border-border bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
        <span>
          {files.length} changed file{files.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto shrink-0 font-mono tabular-nums" title="Lines added / removed across this commit">
          <span className="text-green-700 dark:text-green-400">+{totals.additions}</span>{" "}
          <span className="text-red-700 dark:text-red-400">-{totals.deletions}</span>
        </span>
      </div>
      {parents.length > 1 ? (
        <div className="flex items-center gap-1.5 border-b border-border bg-yellow-50 px-3 py-1 text-[11px] text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300">
          <GitMerge className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Merge commit — diff against</span>
          <select
            value={effectiveParent ?? ""}
            onChange={(event) => {
              setExplicitParent(event.target.value);
              setSelectedPath(null);
            }}
            aria-label="Parent commit to diff against"
            className="rounded border border-border bg-card px-1 py-0.5 font-mono text-[11px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {parents.map((parent, index) => (
              <option key={parent} value={parent}>
                {parent.slice(0, 8)}
                {index === 0 ? " (default)" : ""}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <ul>
        {files.map((file, index) => {
          const badge = changeTypeBadge(file.changeType);
          const selected = file.path === selectedPath;
          const stats = diffStats(diffQueries[index]?.data);
          return (
            <li key={file.path}>
              <div
                className={`flex items-center pr-1 ${
                  selected ? "bg-secondary" : "hover:bg-muted/50"
                }`}
              >
                <button
                  type="button"
                  ref={(el) => {
                    rowRefs.current[index] = el;
                  }}
                  tabIndex={index === tabStopIndex ? 0 : -1}
                  onClick={() => setSelectedPath(selected ? null : file.path)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-1 text-left text-xs"
                  title={file.path}
                >
                  <span
                    className={`inline-flex w-4 shrink-0 items-center justify-center rounded border text-[10px] font-semibold ${badge.cls}`}
                    aria-label={file.changeType}
                  >
                    {badge.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono">{fileName(file.path)}</span>
                  {stats ? (
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                      <span className="text-green-700 dark:text-green-400">+{stats.additions}</span>{" "}
                      <span className="text-red-700 dark:text-red-400">-{stats.deletions}</span>
                    </span>
                  ) : null}
                </button>
                {commitWebUrl ? (
                  <button
                    type="button"
                    onClick={() => openExternalUrl(fileDiffUrl(commitWebUrl, file.path))}
                    title={`Open diff in Azure DevOps: ${file.path}`}
                    aria-label={`Open diff for ${fileName(file.path)} in Azure DevOps`}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              {selected ? (
                <div className="border-y border-border">
                  {selectedDiff?.isLoading ? (
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading
                      diff…
                    </div>
                  ) : selectedDiff?.isError ? (
                    <p className="px-3 py-2 text-xs text-destructive">
                      {commandErrorMessage(selectedDiff.error)}
                    </p>
                  ) : selectedDiff?.data ? (
                    <CommitDiffView
                      baseContent={selectedDiff.data.baseContent}
                      targetContent={selectedDiff.data.targetContent}
                      baseUnavailableReason={selectedDiff.data.baseUnavailableReason}
                      targetUnavailableReason={selectedDiff.data.targetUnavailableReason}
                    />
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
