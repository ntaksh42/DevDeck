import { type ReactNode, Fragment, forwardRef } from 'react';
import { type PullRequestSummary } from '@/lib/azdoCommands';
import { formatDate, formatRelativeDate } from '@/lib/utils';
import { openExternalUrl } from '@/lib/openExternal';
import { focusPrimaryPreview } from '@/lib/utils';
import { PR_STATUS_COLORS, type PrSearchColumnKey } from './PrSearchTypes';

// Cells stay direct grid items (keyed Fragment) so the column template lines up.
export function renderPrSearchCell(key: PrSearchColumnKey, pr: PullRequestSummary): ReactNode {
  switch (key) {
    case "pullRequestId":
      return (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (pr.webUrl) openExternalUrl(pr.webUrl); }}
          className="truncate text-left font-mono text-xs text-primary hover:underline"
          title={`PR #${pr.pullRequestId}`}
        >
          #{pr.pullRequestId}
        </button>
      );
    case "status": {
      const statusColor = PR_STATUS_COLORS[pr.status] ?? "bg-secondary text-foreground border-border";
      return (
        <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium capitalize ${statusColor}`}>
          {pr.status}
        </span>
      );
    }
    case "title":
      return (
        <span className="truncate font-medium text-foreground" title={pr.title}>
          {pr.title}
        </span>
      );
    case "repository":
      return (
        <span className="truncate text-xs text-muted-foreground" title={`${pr.projectName} / ${pr.repositoryName}`}>
          {pr.projectName} / {pr.repositoryName}
        </span>
      );
    case "author":
      return (
        <span className="truncate text-sm text-muted-foreground" title={pr.createdBy ?? "Unknown"}>
          {pr.createdBy ?? "Unknown"}
        </span>
      );
    case "date":
      return (
        <span className="text-xs text-muted-foreground" title={formatDate(pr.creationDate)}>
          {formatRelativeDate(pr.creationDate)}
        </span>
      );
    case "branch":
      return (
        <span className="truncate text-xs text-muted-foreground" title={`${pr.sourceRefName} → ${pr.targetRefName}`}>
          {pr.sourceRefName} → {pr.targetRefName}
        </span>
      );
  }
}

export const PrSearchRow = forwardRef<
  HTMLDivElement,
  {
    pr: PullRequestSummary;
    selected: boolean;
    columnTemplate: string;
    visibleColumns: PrSearchColumnKey[];
    onSelect: () => void;
  }
>(({ pr, selected, columnTemplate, visibleColumns, onSelect }, ref) => {
  return (
    <div
      ref={ref}
      tabIndex={selected ? 0 : -1}
      role="row"
      aria-selected={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (e.key === "Enter") {
          e.stopPropagation();
          if (e.ctrlKey && pr.webUrl) openExternalUrl(pr.webUrl);
          else focusPrimaryPreview();
        }
      }}
      className={`grid h-[29px] cursor-pointer select-none items-center gap-2 border-b border-border px-2 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
        selected ? "bg-secondary" : "hover:bg-muted/50"
      }`}
      style={{ gridTemplateColumns: columnTemplate }}
    >
      {visibleColumns.map((key) => (
        <Fragment key={key}>{renderPrSearchCell(key, pr)}</Fragment>
      ))}
    </div>
  );
});
PrSearchRow.displayName = "PrSearchRow";
