import { type ReactNode, Fragment, forwardRef } from "react";
import { type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, GitPullRequest } from "lucide-react";
import { type CommitSummary, getCommitPullRequests } from "@/lib/azdoCommands";
import { focusPrimaryPreview, formatDate, formatRelativeDate } from "@/lib/utils";
import { openExternalUrl } from "@/lib/openExternal";
import {
  type CommitColumnKey,
  type CommitSortKey,
  type CommitSortState,
  commitSortLabels,
} from "./commitSearchConstants";
import { commitPrQueryKey } from "./commitSearchUtils";

// Cells stay direct grid items (keyed Fragment) so the column template lines up.
function renderCommitCell(key: CommitColumnKey, commit: CommitSummary, prCount: number): ReactNode {
  switch (key) {
    case "sha":
      return (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (commit.webUrl) openExternalUrl(commit.webUrl); }}
          className="truncate text-left font-mono text-xs text-primary hover:underline"
          title={commit.commitId}
        >
          {commit.shortCommitId}
        </button>
      );
    case "date":
      return (
        <span
          className="text-xs text-muted-foreground"
          title={commit.authorDate ? formatDate(commit.authorDate) : undefined}
        >
          {commit.authorDate ? formatRelativeDate(commit.authorDate) : "—"}
        </span>
      );
    case "comment": {
      const message = commit.comment.split(/\r?\n/, 1)[0] || "(no comment)";
      return (
        <span className="truncate font-medium text-foreground" title={commit.comment}>
          {message}
        </span>
      );
    }
    case "repository":
      return (
        <span className="truncate text-xs text-muted-foreground" title={`${commit.projectName} / ${commit.repositoryName}`}>
          {commit.projectName} / {commit.repositoryName}
        </span>
      );
    case "author":
      return (
        <span className="truncate text-xs text-muted-foreground" title={commit.authorName ?? undefined}>
          {commit.authorName ?? "—"}
        </span>
      );
    case "pr":
      return (
        <span className="flex items-center justify-center" aria-hidden={prCount === 0}>
          {prCount > 0 ? (
            <span
              className="inline-flex items-center gap-0.5 text-primary"
              title={`In ${prCount} pull request${prCount === 1 ? "" : "s"}`}
              aria-label={`In ${prCount} pull request${prCount === 1 ? "" : "s"}`}
            >
              <GitPullRequest className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="text-[11px] tabular-nums">{prCount}</span>
            </span>
          ) : null}
        </span>
      );
  }
}

export function CommitSortHeaderButton({
  column,
  sort,
  onSort,
  resizeHandle,
}: {
  column: CommitSortKey;
  sort: CommitSortState;
  onSort: (column: CommitSortKey) => void;
  resizeHandle?: ReactNode;
}) {
  const active = sort.key === column;
  const label = commitSortLabels[column];
  return (
    <div
      role="columnheader"
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className="relative min-w-0"
    >
      <button
        type="button"
        aria-label={`Sort by ${label}`}
        onClick={() => onSort(column)}
        className={`flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring ${
          active ? "text-foreground" : ""
        }`}
      >
        <span className="truncate">{label}</span>
        {active ? (
          sort.direction === "asc" ? (
            <ChevronUp className="h-3 w-3 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
          )
        ) : (
          <span className="h-3 w-3 shrink-0" aria-hidden="true" />
        )}
      </button>
      {resizeHandle}
    </div>
  );
}

export const CommitGridRow = forwardRef<
  HTMLDivElement,
  {
    commit: CommitSummary;
    selected: boolean;
    columnTemplate: string;
    visibleColumns: CommitColumnKey[];
    onSelect: () => void;
  }
>(({ commit, selected, columnTemplate, visibleColumns, onSelect }, ref) => {
  // Reflects the related-PR lookup that the preview triggers on selection;
  // reads cached query data only, so the grid never fans out N requests.
  const prQuery = useQuery({
    queryKey: commitPrQueryKey(commit),
    queryFn: () => getCommitPullRequests(commit),
    enabled: false,
  });
  const prCount = prQuery.data?.length ?? 0;
  return (
    <div
      ref={ref}
      tabIndex={selected ? 0 : -1}
      role="row"
      aria-selected={selected}
      onClick={onSelect}
      onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (e.key === "Enter") {
          e.stopPropagation();
          if (e.ctrlKey && commit.webUrl) openExternalUrl(commit.webUrl);
          else focusPrimaryPreview();
        }
      }}
      className={`grid h-[29px] cursor-pointer select-none items-center gap-2 border-b border-border px-2 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
        selected ? "bg-secondary" : "hover:bg-muted/50"
      }`}
      style={{ gridTemplateColumns: columnTemplate }}
    >
      {visibleColumns.map((key) => (
        <Fragment key={key}>{renderCommitCell(key, commit, prCount)}</Fragment>
      ))}
    </div>
  );
});
CommitGridRow.displayName = "CommitGridRow";
