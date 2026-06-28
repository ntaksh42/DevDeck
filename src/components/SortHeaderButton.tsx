import { type ReactNode } from "react";
import { ChevronDown, ChevronUp, Filter } from "lucide-react";
import { type SortDirection } from "@/lib/utils";

// Sortable column header shared by the grids whose headers sort by a column key
// (My Reviews, My Pull Requests). The optional filter button renders only when
// `onFilterOpen` is provided, so callers without per-column filters get a plain
// sort header. `label` is passed in rather than read from a module-local label
// map so the component stays agnostic of each grid's key set.
export function SortHeaderButton<Key extends string>({
  column,
  label,
  sort,
  onSort,
  resizeHandle,
  filterActive,
  onFilterOpen,
}: {
  column: Key;
  label: string;
  sort: { key: Key; direction: SortDirection };
  onSort: (column: Key) => void;
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
        {onFilterOpen ? (
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
        ) : null}
      </div>
      {resizeHandle}
    </div>
  );
}
