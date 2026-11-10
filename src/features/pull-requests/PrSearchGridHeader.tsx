import { Filter } from "lucide-react";
import { ColumnResizeHandle } from "@/components/ResizeHandle";
import type { useGridColumns } from "@/lib/useGridColumns";
import type { ColumnDragProps } from "@/lib/columnDrag";
import { PR_SEARCH_COLUMN_LABELS, PR_SEARCH_COLUMN_FILTER_KEY, type PrSearchColumnKey, type PrSearchFilterableColumn } from "./PrSearchTypes";

export function PrSearchGridHeader({ columns, template, filters, resizeProps, columnDrag, onFilter }: {
  columns: PrSearchColumnKey[];
  template: string;
  filters: Partial<Record<PrSearchFilterableColumn, Set<string>>>;
  resizeProps: ReturnType<typeof useGridColumns<PrSearchColumnKey>>['resizeProps'];
  columnDrag?: (key: PrSearchColumnKey) => ColumnDragProps;
  onFilter: (column: PrSearchFilterableColumn, owner: HTMLButtonElement) => void;
}) {
  return <div role="row" className="grid border-b border-border bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground" style={{ gridTemplateColumns: template }}>
    {columns.map((key, index) => {
      const filterKey = PR_SEARCH_COLUMN_FILTER_KEY[key];
      return <div key={key} role="columnheader" className="relative min-w-0 px-1 data-[drop-target=true]:bg-primary/15 data-[drop-target=true]:ring-1 data-[drop-target=true]:ring-primary" {...columnDrag?.(key).cell}>
        <div className="flex min-w-0 items-center"><span className="truncate" {...columnDrag?.(key).handle}>{PR_SEARCH_COLUMN_LABELS[key]}</span>
          {filterKey ? <button type="button" aria-label={`Filter by ${PR_SEARCH_COLUMN_LABELS[key]}`} onClick={(event) => onFilter(filterKey, event.currentTarget)}
            className={`ml-1 shrink-0 rounded p-0.5 focus:outline-none focus:ring-1 focus:ring-ring ${filters[filterKey] !== undefined ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}><Filter className="h-3 w-3" aria-hidden="true" /></button> : null}
        </div>
        {index === columns.length - 1 ? null : <ColumnResizeHandle {...resizeProps(key)} />}
      </div>;
    })}
  </div>;
}
