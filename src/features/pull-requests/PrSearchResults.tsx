import { type CSSProperties, useEffect, useRef, useMemo, useState } from 'react';
import { Filter } from 'lucide-react';
import { type PullRequestSummary } from '@/lib/azdoCommands';
import {
  clamp,
  storedNumber,
  isEditableTarget,
  focusFilterInput,
  focusPrimaryPreview,
  markdownLink,
} from '@/lib/utils';
import { useGridColumns } from '@/lib/useGridColumns';
import { useColumnVisibility } from '@/lib/useColumnVisibility';
import { useGridVirtualizer } from '@/lib/useGridVirtualizer';
import { openExternalUrl } from '@/lib/openExternal';
import { recordRecentPullRequest } from '@/lib/recentItems';
import { ColumnResizeHandle, ResizeHandle } from '@/components/ResizeHandle';
import { ColumnVisibilityMenu } from '@/components/ColumnVisibilityMenu';
import { LoadingState } from '@/components/StateDisplay';
import { ActiveFilters } from '@/components/ActiveFilters';
import { ColumnFilterDropdown } from '@/components/ColumnFilterDropdown';
import {
  activeColumnFilterCount,
  applyColumnFilters,
  columnFilterUniqueValues,
  toggleColumnFilterValue,
} from '@/lib/columnFilters';
import { PrReviewPanel } from './PrReviewPanel';
import { PrSearchRow } from './PrSearchRow';
import {
  type PrSearchFilterableColumn,
  PR_SEARCH_KEYS,
  PR_SEARCH_COLUMN_LABELS,
  PR_SEARCH_REQUIRED_COLUMNS,
  PR_SEARCH_COLUMN_FILTER_KEY,
  PR_SEARCH_VISIBLE_COLUMNS_STORAGE_KEY,
  PR_SEARCH_FILTERABLE_COLUMNS,
  DEFAULT_PR_SEARCH_COLUMN_WIDTHS,
  PR_SEARCH_COLUMN_MIN_WIDTHS,
  PR_SEARCH_COLUMN_MAX_WIDTHS,
  PR_SEARCH_COLUMN_WIDTHS_STORAGE_KEY,
  PR_SEARCH_ROW_HEIGHT,
  PR_SEARCH_OVERSCAN,
  DEFAULT_PR_SEARCH_PREVIEW_WIDTH,
  MIN_PR_SEARCH_PREVIEW_WIDTH,
  MAX_PR_SEARCH_PREVIEW_WIDTH,
  PR_SEARCH_PREVIEW_WIDTH_STORAGE_KEY,
  toReviewSummary,
} from './PrSearchTypes';

export function PullRequestResults({
  activeExternalFilterCount = 0,
  loading,
  onClearExternalFilters,
  results,
  searched,
  truncated = false,
  total = 0,
}: {
  activeExternalFilterCount?: number;
  loading: boolean;
  onClearExternalFilters?: () => void;
  results: PullRequestSummary[];
  searched: boolean;
  truncated?: boolean;
  total?: number;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [columnFilters, setColumnFilters] = useState<Partial<Record<PrSearchFilterableColumn, Set<string>>>>({});
  const [openFilterCol, setOpenFilterCol] = useState<PrSearchFilterableColumn | null>(null);
  const [filterAnchorRect, setFilterAnchorRect] = useState<DOMRect | null>(null);
  // The filter button that opened the dropdown, so focus can return to it on close.
  const filterButtonRef = useRef<HTMLElement | null>(null);
  const { visibleColumns, toggleColumn, resetColumns } = useColumnVisibility({
    keys: PR_SEARCH_KEYS,
    requiredColumns: PR_SEARCH_REQUIRED_COLUMNS,
    storageKey: PR_SEARCH_VISIBLE_COLUMNS_STORAGE_KEY,
  });
  const {
    template: columnTemplate,
    minWidth: gridMinWidth,
    resizeProps: columnResizeProps,
  } = useGridColumns({
    keys: PR_SEARCH_KEYS,
    visibleColumns,
    flexibleKey: "title",
    defaults: DEFAULT_PR_SEARCH_COLUMN_WIDTHS,
    min: PR_SEARCH_COLUMN_MIN_WIDTHS,
    max: PR_SEARCH_COLUMN_MAX_WIDTHS,
    storageKey: PR_SEARCH_COLUMN_WIDTHS_STORAGE_KEY,
  });
  const [columnMenuRect, setColumnMenuRect] = useState<DOMRect | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(() =>
    storedNumber(
      PR_SEARCH_PREVIEW_WIDTH_STORAGE_KEY,
      DEFAULT_PR_SEARCH_PREVIEW_WIDTH,
      MIN_PR_SEARCH_PREVIEW_WIDTH,
      MAX_PR_SEARCH_PREVIEW_WIDTH,
    ),
  );
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const restoreFocusRef = useRef(false);
  useEffect(() => {
    localStorage.setItem(PR_SEARCH_PREVIEW_WIDTH_STORAGE_KEY, String(Math.round(previewWidth)));
  }, [previewWidth]);

  const columnUniqueValues = useMemo(
    () => columnFilterUniqueValues(results, PR_SEARCH_FILTERABLE_COLUMNS),
    [results],
  );

  const filteredResults = useMemo(
    () => applyColumnFilters(results, columnFilters, PR_SEARCH_FILTERABLE_COLUMNS),
    [columnFilters, results],
  );

  const {
    scrollerRef,
    firstRow: firstVirtualRow,
    lastRow: lastVirtualRow,
    topPadding: virtualTopPadding,
    bottomPadding: virtualBottomPadding,
    scrollRowIntoView,
  } = useGridVirtualizer({
    rowCount: filteredResults.length,
    rowHeight: PR_SEARCH_ROW_HEIGHT,
    overscan: PR_SEARCH_OVERSCAN,
  });
  const virtualRows = filteredResults.slice(firstVirtualRow, lastVirtualRow);

  const columnFilterCount = activeColumnFilterCount(columnFilters);
  const hasActiveColumnFilters = columnFilterCount > 0;
  const activeFilterCount = Math.max(0, activeExternalFilterCount) + columnFilterCount;

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(filteredResults.length - 1, 0)));
  }, [filteredResults.length]);

  const countLabel = useMemo(() => {
    if (loading) return "Searching";
    if (!searched) return "Ready";
    // When the backend capped the result set, show the cap (e.g. "100+") so the
    // count does not read as the full match total.
    const shown = truncated ? `${results.length}+` : `${results.length}`;
    if (hasActiveColumnFilters) {
      return `${filteredResults.length} of ${shown} pull request${results.length === 1 ? "" : "s"}`;
    }
    const suffix = truncated ? ` (showing first ${results.length} of ${total}+)` : "";
    return `${shown} pull request${results.length === 1 ? "" : "s"}${suffix}`;
  }, [filteredResults.length, hasActiveColumnFilters, loading, results.length, searched, total, truncated]);

  function moveSelectionTo(index: number) {
    const next = clamp(index, 0, filteredResults.length - 1);
    restoreFocusRef.current = true;
    scrollRowIntoView(next);
    setSelectedIndex(next);
  }

  function moveSelection(delta: number) {
    moveSelectionTo(selectedIndex + delta);
  }

  // Rows outside the virtual window unmount, so roving focus is restored once
  // the row for the new selection is mounted again.
  useEffect(() => {
    if (!restoreFocusRef.current) return;
    const row = rowRefs.current[selectedIndex];
    if (!row) return;
    restoreFocusRef.current = false;
    row.focus({ preventScroll: true });
  });

  function openFilter(col: PrSearchFilterableColumn, anchorEl: HTMLButtonElement) {
    filterButtonRef.current = anchorEl;
    setFilterAnchorRect(anchorEl.getBoundingClientRect());
    setOpenFilterCol(col);
  }

  function toggleFilter(col: PrSearchFilterableColumn, value: string) {
    const allValues = columnUniqueValues[col] ?? [];
    setColumnFilters((prev) => toggleColumnFilterValue(prev, col, value, allValues));
    setSelectedIndex(0);
  }

  // Removes the column filter entirely, which means "show all" / (All).
  function clearColumnFilter(col: PrSearchFilterableColumn) {
    setColumnFilters((prev) => {
      const { [col]: _, ...rest } = prev;
      return rest;
    });
    setSelectedIndex(0);
  }

  // Unchecks every value for the column, leaving an explicit empty selection so
  // the user can then pick exactly the values they want.
  function uncheckAllColumnFilter(col: PrSearchFilterableColumn) {
    setColumnFilters((prev) => ({ ...prev, [col]: new Set<string>() }));
    setSelectedIndex(0);
  }

  function clearAllFilters() {
    setColumnFilters({});
    setOpenFilterCol(null);
    setFilterAnchorRect(null);
    onClearExternalFilters?.();
    setSelectedIndex(0);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (isEditableTarget(e.target)) return;
    // Single-letter shortcuts must not swallow app-level chords (Ctrl+K etc.);
    // Ctrl+Enter stays grid-handled to open in Azure DevOps.
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === "Enter") {
        e.preventDefault();
        const pr = filteredResults[selectedIndex];
        if (pr?.webUrl) openExternalUrl(pr.webUrl);
      }
      return;
    }
    if (e.key === "Escape" && openFilterCol) {
      e.preventDefault();
      setOpenFilterCol(null);
      setFilterAnchorRect(null);
      return;
    }
    if (e.key === "/") {
      e.preventDefault();
      focusFilterInput();
      return;
    }
    if (e.key === "\\") {
      e.preventDefault();
      setMaximized((value) => !value);
      return;
    }
    if (filteredResults.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") { e.preventDefault(); moveSelection(1); }
    else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") { e.preventDefault(); moveSelection(-1); }
    else if (e.key === "Home") { e.preventDefault(); moveSelectionTo(0); }
    else if (e.key === "End") { e.preventDefault(); moveSelectionTo(filteredResults.length - 1); }
    else if (e.key === "PageDown") { e.preventDefault(); moveSelection(10); }
    else if (e.key === "PageUp") { e.preventDefault(); moveSelection(-10); }
    else if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); focusPrimaryPreview(); }
    else if (e.key === "o" || e.key === "O") {
      e.preventDefault();
      const pr = filteredResults[selectedIndex];
      if (pr?.webUrl) openExternalUrl(pr.webUrl);
    }
    else if (e.key === "c" || e.key === "C") {
      e.preventDefault();
      const pr = filteredResults[selectedIndex];
      if (pr?.webUrl) {
        void navigator.clipboard.writeText(pr.webUrl).then(() => {
          setCopyToast("URL copied");
          window.setTimeout(() => setCopyToast(null), 2000);
        });
      }
    }
    else if (e.key === "l" || e.key === "L") {
      e.preventDefault();
      const pr = filteredResults[selectedIndex];
      if (pr?.webUrl) {
        void navigator.clipboard
          .writeText(markdownLink(`!${pr.pullRequestId} ${pr.title}`, pr.webUrl))
          .then(() => {
            setCopyToast("Markdown link copied");
            window.setTimeout(() => setCopyToast(null), 2000);
          });
      }
    }
  }

  const selectedResult = filteredResults[selectedIndex] ?? null;
  const selectedPr = selectedResult ? toReviewSummary(selectedResult) : null;

  useEffect(() => {
    if (selectedResult) recordRecentPullRequest(selectedResult);
  }, [selectedResult]);

  return (
    <div
      className={
        maximized
          ? "flex min-h-0 flex-1"
          : "grid min-h-0 flex-1 items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_8px_minmax(320px,var(--pr-preview-width))]"
      }
      style={{ "--pr-preview-width": `${previewWidth}px` } as CSSProperties}
    >
      <div
        className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card ${
          maximized ? "hidden" : ""
        }`}
      >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-base font-semibold">Results</h2>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          {countLabel}
          <ActiveFilters count={activeFilterCount} onClear={clearAllFilters} />
          <button
            type="button"
            onClick={(event) => setColumnMenuRect(event.currentTarget.getBoundingClientRect())}
            className="rounded border border-border bg-card px-2 py-0.5 text-xs hover:bg-secondary"
          >
            Columns
          </button>
        </span>
      </div>
      {!searched && !loading ? (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
          Run a search to load pull requests.
        </div>
      ) : results.length === 0 && !loading ? (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
          No pull requests matched.
        </div>
      ) : (
        <div
          role="grid"
          aria-label="Pull request search results"
          data-primary-grid="true"
          tabIndex={-1}
          className="flex min-h-0 flex-1 flex-col outline-none"
          onKeyDown={handleKeyDown}
        >
          <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-auto">
          <div style={{ minWidth: gridMinWidth }}>
          <div
            role="row"
            className="grid border-b border-border bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground"
            style={{ gridTemplateColumns: columnTemplate }}
          >
            {visibleColumns.map((key, i) => {
              const filterKey = PR_SEARCH_COLUMN_FILTER_KEY[key];
              const isLast = i === visibleColumns.length - 1;
              return (
                <div key={key} role="columnheader" className="relative min-w-0 px-1">
                  <div className="flex min-w-0 items-center">
                    <span className="truncate">{PR_SEARCH_COLUMN_LABELS[key]}</span>
                    {filterKey ? (
                      <button
                        type="button"
                        aria-label={`Filter by ${PR_SEARCH_COLUMN_LABELS[key]}`}
                        onClick={(event) => openFilter(filterKey, event.currentTarget)}
                        className={`ml-1 shrink-0 rounded p-0.5 focus:outline-none focus:ring-1 focus:ring-ring ${
                          columnFilters[filterKey] !== undefined
                            ? "text-primary"
                            : "text-muted-foreground/40 hover:text-muted-foreground"
                        }`}
                      >
                        <Filter className="h-3 w-3" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                  {isLast ? null : (
                    <ColumnResizeHandle {...columnResizeProps(key)} />
                  )}
                </div>
              );
            })}
          </div>
          {loading ? (
            <LoadingState />
          ) : filteredResults.length === 0 ? (
            <div className="flex min-h-24 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <span>No results match the active filters.</span>
              <button
                type="button"
                onClick={clearAllFilters}
                className="rounded border border-border px-2 py-0.5 text-xs hover:bg-secondary"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <>
              {virtualTopPadding > 0 ? <div style={{ height: virtualTopPadding }} /> : null}
              {virtualRows.map((pr, offset) => {
                const index = firstVirtualRow + offset;
                return (
                  <PrSearchRow
                    key={`${pr.repositoryId}:${pr.pullRequestId}`}
                    ref={(el) => { rowRefs.current[index] = el; }}
                    pr={pr}
                    selected={index === selectedIndex}
                    columnTemplate={columnTemplate}
                    visibleColumns={visibleColumns}
                    onSelect={() => setSelectedIndex(index)}
                  />
                );
              })}
              {virtualBottomPadding > 0 ? <div style={{ height: virtualBottomPadding }} /> : null}
            </>
          )}
          </div>
          </div>
        </div>
      )}
      </div>

      <ResizeHandle
        ariaLabel="Resize pull request preview"
        className={maximized ? "hidden" : "hidden xl:flex"}
        direction={-1}
        max={MAX_PR_SEARCH_PREVIEW_WIDTH}
        min={MIN_PR_SEARCH_PREVIEW_WIDTH}
        onChange={setPreviewWidth}
        onReset={() => setPreviewWidth(DEFAULT_PR_SEARCH_PREVIEW_WIDTH)}
        value={previewWidth}
      />

      <PrReviewPanel
        selectedPr={selectedPr}
        maximized={maximized}
        onToggleMaximize={() => setMaximized((value) => !value)}
      />

      {copyToast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-3 py-1 text-xs text-background shadow-lg">
          {copyToast}
        </div>
      )}
      {openFilterCol && filterAnchorRect ? (
        <ColumnFilterDropdown
          anchorRect={filterAnchorRect}
          allValues={columnUniqueValues[openFilterCol] ?? []}
          activeValues={columnFilters[openFilterCol]}
          onToggle={(value) => toggleFilter(openFilterCol, value)}
          onClearAll={() => clearColumnFilter(openFilterCol)}
          restoreFocusRef={filterButtonRef}
          onUncheckAll={() => uncheckAllColumnFilter(openFilterCol)}
          onClose={() => {
            setOpenFilterCol(null);
            setFilterAnchorRect(null);
          }}
        />
      ) : null}
      {columnMenuRect ? (
        <ColumnVisibilityMenu
          anchorRect={columnMenuRect}
          columns={PR_SEARCH_KEYS.map((key) => ({ key, label: PR_SEARCH_COLUMN_LABELS[key] }))}
          visibleColumns={visibleColumns}
          requiredColumns={PR_SEARCH_REQUIRED_COLUMNS}
          onToggle={toggleColumn}
          onReset={resetColumns}
          onClose={() => setColumnMenuRect(null)}
        />
      ) : null}
    </div>
  );
}
