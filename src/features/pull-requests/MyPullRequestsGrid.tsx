import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { commandErrorMessage, listMyCreatedPullRequests } from "@/lib/azdoCommands";
import { useActiveOrganizationId } from "@/lib/useActiveConnection";
import {
  isEditableTarget,
  matchesAllSearchTerms,
  splitSearchTerms,
} from "@/lib/utils";
import { FilterAutocomplete } from "@/components/FilterAutocomplete";
import { ColumnResizeHandle } from "@/components/ResizeHandle";
import { ColumnVisibilityMenu } from "@/components/ColumnVisibilityMenu";
import { useGridColumns } from "@/lib/useGridColumns";
import { useColumnVisibility } from "@/lib/useColumnVisibility";
import { useRangeSelection } from "@/lib/useRangeSelection";
import { copyRowUrls } from "@/lib/copyUrls";
import { CreatedPrRow, SortHeaderButton } from "./MyPullRequestsRow";
import {
  comparePrs,
  defaultSortDirection,
  sortLabels,
  GRID_KEYS,
  REQUIRED_COLUMNS,
  DEFAULT_COLUMN_WIDTHS,
  COLUMN_MIN_WIDTHS,
  COLUMN_MAX_WIDTHS,
  COLUMN_WIDTHS_STORAGE_KEY,
  VISIBLE_COLUMNS_STORAGE_KEY,
  type SortKey,
  type SortState,
} from "./myPullRequestsTypes";

// Active pull requests the authenticated user authored. Fetched live from Azure
// DevOps (not from the local sync cache), so data refreshes on view re-entry
// rather than via the sync:updated wiring the cached review grid uses. The grid
// layout, resizable/toggleable columns, sort headers, row styling, keyboard,
// and status bar mirror MyReviewsGrid.
export function MyPullRequestsGrid() {
  const organizationId = useActiveOrganizationId();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sort, setSort] = useState<SortState>({ key: "creationDate", direction: "desc" });
  const [textFilter, setTextFilter] = useState("");
  const { visibleColumns, toggleColumn, resetColumns } = useColumnVisibility({
    keys: GRID_KEYS,
    requiredColumns: REQUIRED_COLUMNS,
    storageKey: VISIBLE_COLUMNS_STORAGE_KEY,
  });
  const [columnMenuRect, setColumnMenuRect] = useState<DOMRect | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);

  const {
    template,
    minWidth: gridMinWidth,
    resetWidths,
    resizeProps: columnResizeProps,
  } = useGridColumns({
    keys: GRID_KEYS,
    visibleColumns,
    flexibleKey: "title",
    defaults: DEFAULT_COLUMN_WIDTHS,
    min: COLUMN_MIN_WIDTHS,
    max: COLUMN_MAX_WIDTHS,
    storageKey: COLUMN_WIDTHS_STORAGE_KEY,
  });

  const query = useQuery({
    queryKey: ["myCreatedPullRequests", organizationId],
    queryFn: () => listMyCreatedPullRequests({ organizationId }),
    enabled: organizationId !== "",
  });

  const allPrs = useMemo(() => query.data ?? [], [query.data]);

  // Autocomplete pool: the repo/target/title values already loaded, mirroring
  // the My Reviews value-suggestion filter.
  const suggestionPool = useMemo(() => {
    const pool = new Set<string>();
    for (const pr of allPrs) {
      pool.add(pr.repositoryName);
      pool.add(pr.targetRefName);
      pool.add(pr.title);
    }
    return [...pool].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [allPrs]);

  const rows = useMemo(() => {
    const terms = splitSearchTerms(textFilter);
    const data = allPrs.filter((pr) =>
      matchesAllSearchTerms(terms, [
        pr.pullRequestId,
        pr.repositoryName,
        pr.title,
        pr.targetRefName,
      ]),
    );
    const factor = sort.direction === "asc" ? 1 : -1;
    data.sort((a, b) => comparePrs(a, b, sort.key) * factor);
    return data;
  }, [allPrs, textFilter, sort]);

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  const selection = useRangeSelection({
    rows,
    keyOf: (pr) => `${pr.repositoryId}:${pr.pullRequestId}`,
    selectedIndex,
  });

  const applySort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: defaultSortDirection(key) },
    );
  };

  // `extend` grows the multi-selection from its anchor; otherwise the move
  // starts a fresh single-row selection.
  const moveSelection = (next: number, extend = false) => {
    const clamped = Math.max(0, Math.min(next, rows.length - 1));
    setSelectedIndex(clamped);
    rowRefs.current[clamped]?.focus();
    if (extend) selection.extendTo(clamped);
    else selection.clear();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target)) return;
    const pr = rows[selectedIndex];
    // Ctrl+C copies the whole selection; other chords belong to the app.
    if (event.ctrlKey || event.metaKey) {
      if ((event.key === "c" || event.key === "C") && !event.altKey) {
        event.preventDefault();
        void copyRowUrls(selection.selectedRows, setCopyToast);
      }
      return;
    }
    if (event.altKey) return;
    if (event.shiftKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      moveSelection(selectedIndex + (event.key === "ArrowDown" ? 1 : -1), true);
      return;
    }
    switch (event.key) {
      case "ArrowDown":
      case "j":
        event.preventDefault();
        moveSelection(selectedIndex + 1);
        break;
      case "ArrowUp":
      case "k":
        event.preventDefault();
        moveSelection(selectedIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        moveSelection(0);
        break;
      case "End":
        event.preventDefault();
        moveSelection(rows.length - 1);
        break;
      case "Escape":
        if (selection.selectedKeys.size > 0) {
          event.preventDefault();
          selection.clear();
        }
        break;
      case "c":
      case "C":
        event.preventDefault();
        if (pr?.webUrl) void navigator.clipboard?.writeText(pr.webUrl);
        break;
      default:
        break;
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card">
      {copyToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 rounded-md bg-foreground px-3 py-2 text-sm text-background shadow-lg"
        >
          {copyToast}
        </div>
      )}
      {/* Toolbar */}
      <div
        className="flex items-center gap-2 border-b border-border px-2 py-1.5"
        onKeyDown={(e) => {
          if (e.key === "Escape" && isEditableTarget(e.target)) {
            e.preventDefault();
            setTextFilter("");
            setSelectedIndex(0);
            const firstRow = rowRefs.current[0];
            if (firstRow) firstRow.focus();
            else (e.target as HTMLElement).blur();
          }
        }}
      >
        <FilterAutocomplete
          value={textFilter}
          onChange={(value) => {
            setTextFilter(value);
            setSelectedIndex(0);
          }}
          onClear={() => setTextFilter("")}
          placeholder="Filter by repo, title, target…"
          suggestionPool={suggestionPool}
          ariaLabel="Filter pull requests"
        />
      </div>

      {query.isLoading ? (
        <p className="px-2 py-3 text-sm text-muted-foreground">Loading…</p>
      ) : query.isError ? (
        <p className="px-2 py-3 text-sm text-destructive">{commandErrorMessage(query.error)}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto" onKeyDown={onKeyDown}>
          <div style={{ minWidth: gridMinWidth }}>
            {/* Column headers */}
            <div
              role="row"
              className="grid items-center gap-2 border-b border-border bg-muted px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              style={{ gridTemplateColumns: template }}
            >
              {visibleColumns.map((col, i) => (
                <SortHeaderButton
                  key={col}
                  column={col}
                  sort={sort}
                  onSort={applySort}
                  resizeHandle={
                    i === visibleColumns.length - 1 ? undefined : (
                      <ColumnResizeHandle {...columnResizeProps(col)} />
                    )
                  }
                />
              ))}
            </div>

            {rows.length === 0 ? (
              <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
                You have no active pull requests in this organization.
              </div>
            ) : (
              <div role="grid" aria-label="My pull requests" data-primary-grid="true" tabIndex={-1}>
                {rows.map((pr, index) => (
                  <CreatedPrRow
                    key={`${pr.repositoryId}-${pr.pullRequestId}`}
                    ref={(el) => {
                      rowRefs.current[index] = el;
                    }}
                    pr={pr}
                    columnTemplate={template}
                    visibleColumns={visibleColumns}
                    selected={index === selectedIndex}
                    inMultiSelection={selection.selectedKeys.has(
                      `${pr.repositoryId}:${pr.pullRequestId}`,
                    )}
                    onSelect={(modifiers) =>
                      selection.handleRowClick(index, modifiers, setSelectedIndex)
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center justify-between border-t border-border px-2 py-1 text-xs text-muted-foreground">
        <span>
          {textFilter.trim() ? `${rows.length} of ${allPrs.length}` : `${rows.length} total`}
          {selection.isMultiSelect ? ` · ${selection.selectedKeys.size} selected` : ""}
          {query.isFetching ? " · refreshing…" : ""}
        </span>
        <button
          type="button"
          onClick={(event) => setColumnMenuRect(event.currentTarget.getBoundingClientRect())}
          className="rounded border border-border bg-card px-2 py-0.5 text-xs hover:bg-secondary"
        >
          Columns
        </button>
      </div>

      {columnMenuRect ? (
        <ColumnVisibilityMenu
          anchorRect={columnMenuRect}
          columns={GRID_KEYS.map((key) => ({ key, label: sortLabels[key] }))}
          visibleColumns={visibleColumns}
          requiredColumns={REQUIRED_COLUMNS}
          onToggle={toggleColumn}
          onReset={() => {
            resetColumns();
            resetWidths();
          }}
          onClose={() => setColumnMenuRect(null)}
        />
      ) : null}
    </div>
  );
}
