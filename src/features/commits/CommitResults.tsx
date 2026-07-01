import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type CommitSummary } from "@/lib/azdoCommands";
import {
  clamp,
  storedNumber,
  isEditableTarget,
  focusFilterInput,
  focusPrimaryPreview,
  markdownLink,
} from "@/lib/utils";
import { openExternalUrl } from "@/lib/openExternal";
import { useGridColumns } from "@/lib/useGridColumns";
import { ColumnResizeHandle, ResizeHandle } from "@/components/ResizeHandle";
import { ColumnVisibilityMenu } from "@/components/ColumnVisibilityMenu";
import { ActiveFilters } from "@/components/ActiveFilters";
import { LoadingState } from "@/components/StateDisplay";
import {
  type CommitColumnKey,
  type CommitSortKey,
  type CommitSortState,
  COMMIT_COLUMN_KEYS,
  COMMIT_COLUMN_LABELS,
  COMMIT_REQUIRED_COLUMNS,
  DEFAULT_COMMIT_COLUMN_WIDTHS,
  COMMIT_COLUMN_MIN_WIDTHS,
  COMMIT_COLUMN_MAX_WIDTHS,
  COMMIT_COLUMN_WIDTHS_STORAGE_KEY,
  COMMIT_GRID_ROW_HEIGHT,
  COMMIT_GRID_OVERSCAN,
  DEFAULT_COMMIT_PREVIEW_WIDTH,
  MIN_COMMIT_PREVIEW_WIDTH,
  MAX_COMMIT_PREVIEW_WIDTH,
  COMMIT_PREVIEW_WIDTH_STORAGE_KEY,
  COMMIT_SORT_STORAGE_KEY,
  COMMIT_VISIBLE_COLUMNS_STORAGE_KEY,
} from "./commitSearchConstants";
import {
  loadCommitSort,
  loadCommitVisibleColumns,
  compareCommitsByKey,
  defaultCommitSortDir,
} from "./commitSearchUtils";
import { CommitGridRow, CommitSortHeaderButton } from "./CommitGridRow";
import { CommitPreviewPanel } from "./CommitPreviewPanel";

export function CommitResults({
  activeExternalFilterCount = 0,
  loading,
  onClearExternalFilters,
  onLoadMore,
  onOpenPullRequest,
  results,
  total,
  truncated = false,
  searched,
}: {
  activeExternalFilterCount?: number;
  loading: boolean;
  onClearExternalFilters?: () => void;
  onLoadMore?: () => void;
  onOpenPullRequest?: (query: string, organizationId?: string) => void;
  results: CommitSummary[];
  total?: number;
  truncated?: boolean;
  searched: boolean;
}) {
  const [sort, setCommitSort] = useState<CommitSortState>(() => loadCommitSort());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [visibleColumns, setVisibleColumns] = useState<CommitColumnKey[]>(
    loadCommitVisibleColumns,
  );
  const {
    template: commitColTemplate,
    minWidth: gridMinWidth,
    resizeProps: columnResizeProps,
  } = useGridColumns({
    keys: COMMIT_COLUMN_KEYS,
    visibleColumns,
    flexibleKey: "comment",
    defaults: DEFAULT_COMMIT_COLUMN_WIDTHS,
    min: COMMIT_COLUMN_MIN_WIDTHS,
    max: COMMIT_COLUMN_MAX_WIDTHS,
    storageKey: COMMIT_COLUMN_WIDTHS_STORAGE_KEY,
  });
  const [columnMenuRect, setColumnMenuRect] = useState<DOMRect | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(() =>
    storedNumber(
      COMMIT_PREVIEW_WIDTH_STORAGE_KEY,
      DEFAULT_COMMIT_PREVIEW_WIDTH,
      MIN_COMMIT_PREVIEW_WIDTH,
      MAX_COMMIT_PREVIEW_WIDTH,
    ),
  );
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const restoreFocusRef = useRef(false);
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);
  const [gridViewport, setGridViewport] = useState({ height: 0, scrollTop: 0 });

  useEffect(() => {
    localStorage.setItem(COMMIT_PREVIEW_WIDTH_STORAGE_KEY, String(Math.round(previewWidth)));
  }, [previewWidth]);

  useEffect(() => {
    if (!scrollerEl) return;

    function updateViewport() {
      setGridViewport({
        height: scrollerEl!.clientHeight,
        scrollTop: scrollerEl!.scrollTop,
      });
    }

    updateViewport();
    scrollerEl.addEventListener("scroll", updateViewport, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateViewport);
    resizeObserver?.observe(scrollerEl);
    return () => {
      scrollerEl.removeEventListener("scroll", updateViewport);
      resizeObserver?.disconnect();
    };
  }, [scrollerEl]);

  useEffect(() => {
    localStorage.setItem(COMMIT_SORT_STORAGE_KEY, JSON.stringify(sort));
  }, [sort]);

  useEffect(() => {
    localStorage.setItem(COMMIT_VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  function toggleColumnVisibility(column: CommitColumnKey) {
    if (COMMIT_REQUIRED_COLUMNS.includes(column)) return;
    setVisibleColumns((current) =>
      current.includes(column)
        ? current.filter((value) => value !== column)
        : COMMIT_COLUMN_KEYS.filter((value) => value === column || current.includes(value)),
    );
  }

  function resetColumnVisibility() {
    setVisibleColumns([...COMMIT_COLUMN_KEYS]);
  }

  const sorted = useMemo(() => {
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...results].sort((a, b) => {
      const primary = compareCommitsByKey(a, b, sort.key);
      if (primary !== 0) return primary * dir;
      return `${a.repositoryId}:${a.commitId}`.localeCompare(`${b.repositoryId}:${b.commitId}`);
    });
  }, [results, sort]);

  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(sorted.length - 1, 0)));
  }, [sorted.length]);

  function applySort(key: CommitSortKey) {
    setCommitSort((current) => {
      if (current.key !== key) return { key, direction: defaultCommitSortDir(key) };
      return { key, direction: current.direction === "asc" ? "desc" : "asc" };
    });
    setSelectedIndex(0);
  }

  function scrollRowIntoView(index: number) {
    if (!scrollerEl) return;
    const rowTop = index * COMMIT_GRID_ROW_HEIGHT;
    const rowBottom = rowTop + COMMIT_GRID_ROW_HEIGHT;
    if (rowTop < scrollerEl.scrollTop) {
      scrollerEl.scrollTop = rowTop;
    } else if (rowBottom > scrollerEl.scrollTop + scrollerEl.clientHeight) {
      scrollerEl.scrollTop = rowBottom - scrollerEl.clientHeight;
    }
  }

  function moveSelectionTo(index: number) {
    const next = clamp(index, 0, sorted.length - 1);
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

  function handleKeyDown(e: ReactKeyboardEvent) {
    if (isEditableTarget(e.target)) return;
    // Single-letter shortcuts must not swallow app-level chords (Ctrl+K etc.);
    // Ctrl+Enter stays grid-handled to open in Azure DevOps.
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === "Enter") {
        e.preventDefault();
        const commit = sorted[selectedIndex];
        if (commit?.webUrl) openExternalUrl(commit.webUrl);
      }
      return;
    }
    if (e.key === "/") { e.preventDefault(); focusFilterInput(); return; }
    if (e.key === "\\") { e.preventDefault(); setMaximized((value) => !value); return; }
    if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") { e.preventDefault(); moveSelection(1); }
    else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") { e.preventDefault(); moveSelection(-1); }
    else if (e.key === "Home") { e.preventDefault(); moveSelectionTo(0); }
    else if (e.key === "End") { e.preventDefault(); moveSelectionTo(sorted.length - 1); }
    else if (e.key === "PageDown") { e.preventDefault(); moveSelection(10); }
    else if (e.key === "PageUp") { e.preventDefault(); moveSelection(-10); }
    else if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); focusPrimaryPreview(); }
    else if (e.key === "o" || e.key === "O") {
      e.preventDefault();
      const commit = sorted[selectedIndex];
      if (commit?.webUrl) openExternalUrl(commit.webUrl);
    } else if (e.key === "c" || e.key === "C") {
      const commit = sorted[selectedIndex];
      if (commit?.webUrl) {
        void navigator.clipboard.writeText(commit.webUrl).then(() => {
          setCopyToast("URL copied");
          window.setTimeout(() => setCopyToast(null), 2000);
        });
      }
    } else if (e.key === "l" || e.key === "L") {
      const commit = sorted[selectedIndex];
      if (commit?.webUrl) {
        const subject = commit.comment.split(/\r?\n/, 1)[0] || "(no comment)";
        void navigator.clipboard
          .writeText(markdownLink(`${commit.shortCommitId} ${subject}`, commit.webUrl))
          .then(() => {
            setCopyToast("Markdown link copied");
            window.setTimeout(() => setCopyToast(null), 2000);
          });
      }
    }
  }

  const countLabel = useMemo(() => {
    if (loading) return "Searching";
    if (!searched) return "Ready";
    if (truncated) {
      return `Showing ${results.length} of ${total ?? results.length} commits`;
    }
    return `${results.length} commit${results.length === 1 ? "" : "s"}`;
  }, [loading, results.length, searched, truncated, total]);
  const activeFilterCount = Math.max(0, activeExternalFilterCount);

  const firstVirtualRow = Math.max(
    0,
    Math.floor(gridViewport.scrollTop / COMMIT_GRID_ROW_HEIGHT) - COMMIT_GRID_OVERSCAN,
  );
  const visibleRowCount = Math.ceil(
    Math.max(gridViewport.height, COMMIT_GRID_ROW_HEIGHT) / COMMIT_GRID_ROW_HEIGHT,
  );
  const lastVirtualRow = Math.min(
    sorted.length,
    firstVirtualRow + visibleRowCount + COMMIT_GRID_OVERSCAN * 2,
  );
  const virtualRows = sorted.slice(firstVirtualRow, lastVirtualRow);
  const virtualTopPadding = firstVirtualRow * COMMIT_GRID_ROW_HEIGHT;
  const virtualBottomPadding =
    Math.max(0, sorted.length - lastVirtualRow) * COMMIT_GRID_ROW_HEIGHT;

  const selectedCommit = sorted[selectedIndex] ?? null;

  return (
    <div
      className={
        maximized
          ? "flex min-h-0 flex-1"
          : "grid min-h-0 flex-1 items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_8px_minmax(320px,var(--commit-preview-width))]"
      }
      style={{ "--commit-preview-width": `${previewWidth}px` } as CSSProperties}
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
          <ActiveFilters count={activeFilterCount} onClear={onClearExternalFilters ?? (() => {})} />
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
          Run a search to load commits.
        </div>
      ) : results.length === 0 && !loading ? (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
          No commits matched.
        </div>
      ) : (
        <div
          role="grid"
          aria-label="Commit search results"
          data-primary-grid="true"
          tabIndex={-1}
          className="flex min-h-0 flex-1 flex-col outline-none"
          onKeyDown={handleKeyDown}
        >
          <div ref={setScrollerEl} className="min-h-0 flex-1 overflow-y-auto overflow-x-auto">
          <div style={{ minWidth: gridMinWidth }}>
            <div
              role="row"
              className="grid items-center gap-2 border-b border-border bg-muted px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              style={{ gridTemplateColumns: commitColTemplate }}
            >
              {visibleColumns.map((col, i) => {
                const isLast = i === visibleColumns.length - 1;
                const resizeHandle = isLast ? undefined : (
                  <ColumnResizeHandle {...columnResizeProps(col)} />
                );
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
                  <CommitSortHeaderButton
                    key={col}
                    column={col}
                    sort={sort}
                    onSort={applySort}
                    resizeHandle={resizeHandle}
                  />
                );
              })}
            </div>
            {loading ? (
              <LoadingState />
            ) : (
              <>
                {virtualTopPadding > 0 ? <div style={{ height: virtualTopPadding }} /> : null}
                {virtualRows.map((commit, offset) => {
                  const index = firstVirtualRow + offset;
                  return (
                    <CommitGridRow
                      key={`${commit.repositoryId}:${commit.commitId}`}
                      ref={(el) => { rowRefs.current[index] = el; }}
                      commit={commit}
                      selected={index === selectedIndex}
                      columnTemplate={commitColTemplate}
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
      {onLoadMore && truncated && searched && !loading ? (
        <div className="shrink-0 border-t border-border px-3 py-2 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Load more commits
          </button>
        </div>
      ) : null}
      </div>

      <ResizeHandle
        ariaLabel="Resize commit preview"
        className={maximized ? "hidden" : "hidden xl:flex"}
        direction={-1}
        max={MAX_COMMIT_PREVIEW_WIDTH}
        min={MIN_COMMIT_PREVIEW_WIDTH}
        onChange={setPreviewWidth}
        onReset={() => setPreviewWidth(DEFAULT_COMMIT_PREVIEW_WIDTH)}
        value={previewWidth}
      />

      <CommitPreviewPanel
        commit={selectedCommit}
        maximized={maximized}
        onToggleMaximize={() => setMaximized((value) => !value)}
        onOpenPullRequest={onOpenPullRequest}
      />

      {/* Always in DOM so aria-live fires correctly when content changes. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-3 py-1 text-xs text-background shadow-lg transition-opacity ${
          copyToast ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {copyToast}
      </div>
      {columnMenuRect ? (
        <ColumnVisibilityMenu
          anchorRect={columnMenuRect}
          columns={COMMIT_COLUMN_KEYS.map((key) => ({ key, label: COMMIT_COLUMN_LABELS[key] }))}
          visibleColumns={visibleColumns}
          requiredColumns={COMMIT_REQUIRED_COLUMNS}
          onToggle={toggleColumnVisibility}
          onReset={resetColumnVisibility}
          onClose={() => setColumnMenuRect(null)}
        />
      ) : null}
    </div>
  );
}
