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
import { isUnlinkedCommit } from "./commitLinks";
import { ColumnResizeHandle } from "@/components/ResizeHandle";
import { type ColumnResizeProps } from "@/lib/useGridColumns";
import { gridRowStateClass } from "@/lib/gridRowState";

// Cells stay direct grid items (keyed Fragment) so the column template lines up.
function renderCommitCell(
  key: CommitColumnKey,
  commit: CommitSummary,
  prCount: number,
  unlinked: boolean,
): ReactNode {
  switch (key) {
    case "sha":
      return (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (commit.webUrl) openExternalUrl(commit.webUrl); }}
          className="truncate text-left font-mono text-xs text-link hover:underline"
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
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium text-foreground" title={commit.comment}>
            {message}
          </span>
          {unlinked ? (
            <span
              className="shrink-0 rounded border border-amber-500/50 bg-amber-500/10 px-1 text-[10px] font-medium text-amber-700 dark:text-amber-400"
              title="No work item (AB#) mention and not in any pull request"
            >
              Unlinked
            </span>
          ) : null}
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

export function CommitGridHeader({
  visibleColumns,
  columnTemplate,
  sort,
  onSort,
  resizeProps,
}: {
  visibleColumns: CommitColumnKey[];
  columnTemplate: string;
  sort: CommitSortState;
  onSort: (column: CommitSortKey) => void;
  resizeProps: (key: CommitColumnKey) => ColumnResizeProps;
}) {
  return (
    <div
      role="row"
      className="grid items-center gap-2 border-b border-border bg-muted px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      style={{ gridTemplateColumns: columnTemplate }}
    >
      {visibleColumns.map((col, i) => {
        const isLast = i === visibleColumns.length - 1;
        const resizeHandle = isLast ? undefined : <ColumnResizeHandle {...resizeProps(col)} />;
        if (col === "sha") {
          return (
            <div key={col} role="columnheader" className="relative min-w-0 truncate px-1">
              SHA
              {resizeHandle}
            </div>
          );
        }
        if (col === "pr") {
          return (
            <div
              key={col}
              role="columnheader"
              className="relative min-w-0 truncate px-1 text-center"
              title="Pull requests containing this commit"
            >
              PR
              {resizeHandle}
            </div>
          );
        }
        return (
          <CommitSortHeaderButton key={col} column={col} sort={sort} onSort={onSort} resizeHandle={resizeHandle} />
        );
      })}
    </div>
  );
}

export const CommitGridRow = forwardRef<
  HTMLDivElement,
  {
    commit: CommitSummary;
    selected: boolean;
    inMultiSelection: boolean;
    columnTemplate: string;
    visibleColumns: CommitColumnKey[];
    onSelect: (modifiers: { shiftKey: boolean; ctrlKey: boolean }) => void;
  }
>(({ commit, selected, inMultiSelection, columnTemplate, visibleColumns, onSelect }, ref) => {
  // Reflects the related-PR lookup that the preview triggers on selection;
  // reads cached query data only, so the grid never fans out N requests.
  const prQuery = useQuery({
    queryKey: commitPrQueryKey(commit),
    queryFn: () => getCommitPullRequests(commit),
    enabled: false,
  });
  const prCount = prQuery.data?.length ?? 0;
  const unlinked = isUnlinkedCommit(commit, prQuery.data?.length);
  return (
    <div
      ref={ref}
      tabIndex={selected ? 0 : -1}
      role="row"
      aria-selected={selected || inMultiSelection}
      onClick={(e) => onSelect({ shiftKey: e.shiftKey, ctrlKey: e.ctrlKey || e.metaKey })}
      onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (e.key === "Enter") {
          e.stopPropagation();
          if (e.ctrlKey && commit.webUrl) openExternalUrl(commit.webUrl);
          else focusPrimaryPreview();
        }
      }}
      className={`grid h-[29px] cursor-pointer select-none items-center gap-2 border-b border-border px-2 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${gridRowStateClass({ selected, inMultiSelection })}`}
      style={{ gridTemplateColumns: columnTemplate }}
    >
      {visibleColumns.map((key) => (
        <Fragment key={key}>{renderCommitCell(key, commit, prCount, unlinked)}</Fragment>
      ))}
    </div>
  );
});
CommitGridRow.displayName = "CommitGridRow";
