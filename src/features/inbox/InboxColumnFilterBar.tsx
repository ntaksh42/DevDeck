import { Filter } from "lucide-react";
import { activeColumnFilterCount } from "@/lib/columnFilters";
import {
  INBOX_FILTER_COLUMNS,
  INBOX_FILTER_LABELS,
  type InboxFilterColumn,
} from "./inboxColumnFilters";

/** Column headers of the Inbox list: each opens a value filter (Kind / Author / Repo). */
export function InboxColumnFilterBar({
  columnFilters,
  onOpenFilter,
  onClear,
}: {
  columnFilters: Partial<Record<InboxFilterColumn, Set<string>>>;
  onOpenFilter: (column: InboxFilterColumn, anchorEl: HTMLButtonElement) => void;
  onClear: () => void;
}) {
  const activeCount = activeColumnFilterCount(columnFilters);
  return (
    <div
      role="toolbar"
      aria-label="Inbox column filters"
      className="flex shrink-0 items-center gap-1 border-b border-border bg-muted px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
    >
      {INBOX_FILTER_COLUMNS.map((column) => {
        const active = columnFilters[column] !== undefined;
        return (
          <button
            key={column}
            type="button"
            aria-label={`Filter by ${INBOX_FILTER_LABELS[column]}`}
            onClick={(event) => onOpenFilter(column, event.currentTarget)}
            className={`flex items-center gap-1 rounded px-1 py-0.5 hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring ${
              active ? "text-primary" : ""
            }`}
          >
            <span>{INBOX_FILTER_LABELS[column]}</span>
            <Filter className="h-3 w-3" aria-hidden="true" />
          </button>
        );
      })}
      {activeCount > 0 ? (
        <button
          type="button"
          onClick={onClear}
          className="ml-auto rounded px-1 py-0.5 normal-case hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Clear column filters
        </button>
      ) : null}
    </div>
  );
}
