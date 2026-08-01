import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, Filter } from 'lucide-react';
import { ColumnResizeHandle } from '@/components/ResizeHandle';
import type { ColumnResizeProps } from '@/lib/useGridColumns';
import type { WorkItemSummary } from '@/lib/azdoCommands';
import {
  wiSortLabels,
  isFilterableColumn,
  type WiSortKey,
  type WiGridSortKey,
  type WiSortState,
  type FilterableColumn,
} from './workItemsGridHelpers';
import { extraColumnKey, extraColumnLabel, type ExtraColumn } from './extraColumns';

// ─── WiSortHeaderButton ───────────────────────────────────────────────────────

function WiSortHeaderButton({
  column,
  label,
  title,
  sort,
  onSort,
  resizeHandle,
  filterActive,
  onFilterOpen,
}: {
  column: WiGridSortKey;
  label: string;
  /** Tooltip for the header, e.g. the full field reference name. */
  title?: string;
  sort: WiSortState;
  onSort: (column: WiGridSortKey) => void;
  resizeHandle?: ReactNode;
  filterActive?: boolean;
  onFilterOpen?: (anchorEl: HTMLButtonElement) => void;
}) {
  const active = sort.key === column;
  return (
    <div
      role="columnheader"
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className="relative min-w-0"
      title={title}
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
        {onFilterOpen && (
          <button
            type="button"
            aria-label={`Filter by ${label}`}
            onClick={(e) => onFilterOpen(e.currentTarget)}
            className={`shrink-0 rounded p-0.5 focus:outline-none focus:ring-1 focus:ring-ring ${
              filterActive
                ? "text-primary"
                : "text-muted-foreground/40 hover:text-muted-foreground"
            }`}
          >
            <Filter className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </div>
      {resizeHandle}
    </div>
  );
}

// ─── WiGridHeader ─────────────────────────────────────────────────────────────

export function WiGridHeader({
  displayed,
  checkedIds,
  setCheckedIds,
  setLastCheckedIndex,
  wiColTemplate,
  visibleColumns,
  sort,
  onSort,
  columnFilters,
  onFilterOpen,
  columnResizeProps,
  extraColumns,
  extraColumnResizeProps,
}: {
  displayed: WorkItemSummary[];
  checkedIds: Set<string>;
  setCheckedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setLastCheckedIndex: React.Dispatch<React.SetStateAction<number | null>>;
  wiColTemplate: string;
  visibleColumns: WiSortKey[];
  sort: WiSortState;
  onSort: (column: WiGridSortKey) => void;
  columnFilters: Partial<Record<FilterableColumn, Set<string>>>;
  onFilterOpen: (col: FilterableColumn, anchorEl: HTMLButtonElement) => void;
  columnResizeProps: (key: WiSortKey) => ColumnResizeProps;
  extraColumns: ExtraColumn[];
  extraColumnResizeProps: (referenceName: string) => ColumnResizeProps;
}) {
  return (
    <div
      role="row"
      className="grid items-center gap-2 border-b border-border bg-muted px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      style={{ gridTemplateColumns: wiColTemplate }}
    >
      <div role="columnheader" className="flex items-center justify-center">
        <input
          type="checkbox"
          aria-label="Select all"
          checked={displayed.length > 0 && displayed.every((item) => checkedIds.has(`${item.organizationId}:${item.projectId}:${item.id}`))}
          ref={(el) => {
            if (el) {
              const some = displayed.some((item) => checkedIds.has(`${item.organizationId}:${item.projectId}:${item.id}`));
              const all = displayed.length > 0 && displayed.every((item) => checkedIds.has(`${item.organizationId}:${item.projectId}:${item.id}`));
              el.indeterminate = some && !all;
            }
          }}
          onChange={(e) => {
            if (e.target.checked) {
              setCheckedIds(new Set(displayed.map((item) => `${item.organizationId}:${item.projectId}:${item.id}`)));
            } else {
              setCheckedIds(new Set());
            }
            setLastCheckedIndex(null);
          }}
          className="h-3.5 w-3.5 cursor-pointer rounded border-input"
        />
      </div>
      {visibleColumns.map((col, i) => (
        <WiSortHeaderButton
          key={col}
          column={col}
          label={wiSortLabels[col]}
          sort={sort}
          onSort={onSort}
          filterActive={isFilterableColumn(col) && columnFilters[col] !== undefined}
          onFilterOpen={isFilterableColumn(col) ? (el) => onFilterOpen(col, el) : undefined}
          resizeHandle={
            // The last track before the extra columns still needs a handle, so
            // only the very last column in the grid goes without one.
            i < visibleColumns.length - 1 || extraColumns.length > 0 ? (
              <ColumnResizeHandle {...columnResizeProps(col)} />
            ) : undefined
          }
        />
      ))}
      {extraColumns.map((column) => (
        <WiSortHeaderButton
          key={column.referenceName}
          column={extraColumnKey(column.referenceName)}
          label={extraColumnLabel(column.referenceName)}
          title={column.referenceName}
          sort={sort}
          onSort={onSort}
          resizeHandle={
            <ColumnResizeHandle {...extraColumnResizeProps(column.referenceName)} />
          }
        />
      ))}
    </div>
  );
}
