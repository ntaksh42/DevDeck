import { type ReactNode, Fragment, forwardRef } from "react";
import { CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { type MyCreatedPullRequestSummary } from "@/lib/azdoCommands";
import { formatDate, formatRelativeDate } from "@/lib/utils";
import { openExternalUrl } from "@/lib/openExternal";
import { sortLabels, type SortKey, type SortState } from "./myPullRequestsTypes";

export function renderCell(key: SortKey, pr: MyCreatedPullRequestSummary): ReactNode {
  switch (key) {
    case "pullRequestId":
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (pr.webUrl) openExternalUrl(pr.webUrl);
          }}
          className="truncate text-left font-mono text-xs text-primary hover:underline"
          title={`PR #${pr.pullRequestId}`}
        >
          #{pr.pullRequestId}
        </button>
      );
    case "repositoryName":
      return (
        <span className="truncate text-sm text-foreground" title={pr.repositoryName}>
          {pr.repositoryName}
        </span>
      );
    case "title":
      return (
        <div className="flex min-w-0 items-center gap-1.5">
          {pr.isDraft && (
            <span className="inline-flex shrink-0 items-center rounded border border-input bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              Draft
            </span>
          )}
          <span className="truncate font-medium text-foreground" title={pr.title}>
            {pr.title}
          </span>
        </div>
      );
    case "creationDate":
      return (
        <span className="text-xs text-muted-foreground" title={formatDate(pr.creationDate)}>
          {formatRelativeDate(pr.creationDate)}
        </span>
      );
    case "targetRefName":
      return (
        <span className="truncate text-xs text-muted-foreground" title={pr.targetRefName}>
          {pr.targetRefName}
        </span>
      );
    case "approvals": {
      const complete = pr.reviewerCount > 0 && pr.approvals >= pr.reviewerCount;
      return (
        <span
          className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground"
          title={`${pr.approvals} of ${pr.reviewerCount} reviewers approved`}
        >
          <CheckCircle2
            className={`h-3.5 w-3.5 ${complete ? "text-green-600 dark:text-green-400" : "text-muted-foreground/50"}`}
            aria-hidden="true"
          />
          {pr.approvals}/{pr.reviewerCount}
        </span>
      );
    }
  }
}

export function SortHeaderButton({
  column,
  sort,
  onSort,
  resizeHandle,
}: {
  column: SortKey;
  sort: SortState;
  onSort: (column: SortKey) => void;
  resizeHandle?: ReactNode;
}) {
  const active = sort.key === column;
  const label = sortLabels[column];
  return (
    <div
      role="columnheader"
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className="relative min-w-0"
    >
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          aria-label={`Sort by ${label}`}
          onClick={() => onSort(column)}
          className={`flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring ${
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
      </div>
      {resizeHandle}
    </div>
  );
}

export const CreatedPrRow = forwardRef<
  HTMLDivElement,
  {
    pr: MyCreatedPullRequestSummary;
    selected: boolean;
    inMultiSelection: boolean;
    columnTemplate: string;
    visibleColumns: SortKey[];
    onSelect: (modifiers: { shiftKey: boolean; ctrlKey: boolean }) => void;
  }
>(({ pr, selected, inMultiSelection, columnTemplate, visibleColumns, onSelect }, ref) => {
  return (
    <div
      ref={ref}
      tabIndex={selected ? 0 : -1}
      role="row"
      aria-selected={selected || inMultiSelection}
      onClick={(e) => onSelect({ shiftKey: e.shiftKey, ctrlKey: e.ctrlKey || e.metaKey })}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (e.key === "Enter") {
          e.stopPropagation();
          if (pr.webUrl) openExternalUrl(pr.webUrl);
        }
      }}
      className={`grid cursor-pointer select-none items-center gap-2 border-b border-border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
        selected ? "bg-secondary" : inMultiSelection ? "bg-secondary/50" : "hover:bg-muted/50"
      }`}
      style={{ gridTemplateColumns: columnTemplate }}
    >
      {visibleColumns.map((key) => (
        <Fragment key={key}>{renderCell(key, pr)}</Fragment>
      ))}
    </div>
  );
});
CreatedPrRow.displayName = "CreatedPrRow";
