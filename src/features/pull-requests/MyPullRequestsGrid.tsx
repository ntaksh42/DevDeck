import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { commandErrorMessage, listMyCreatedPullRequests } from "@/lib/azdoCommands";
import { useActiveOrganizationId } from "@/lib/useActiveConnection";
import {
  focusPrimaryPreview,
  isEditableTarget,
  markdownLink,
  matchesAllSearchTerms,
  splitSearchTerms,
} from "@/lib/utils";
import { DockableWorkspace, type DockablePanelSpec } from "@/components/DockableWorkspace";
import { FilterAutocomplete } from "@/components/FilterAutocomplete";
import { DockFilterBar, useDockFilter } from "@/components/DockFilterBar";
import { ColumnResizeHandle } from "@/components/ResizeHandle";
import { ColumnVisibilityMenu } from "@/components/ColumnVisibilityMenu";
import { useGridColumns } from "@/lib/useGridColumns";
import { useColumnVisibility } from "@/lib/useColumnVisibility";
import { useRangeSelection } from "@/lib/useRangeSelection";
import { copyRowsAsTable } from "@/lib/clipboardTable";
import { openExternalUrl } from "@/lib/openExternal";
import { CreatedPrRow, SortHeaderButton } from "./MyPullRequestsRow";
import { usePrReviewPanels } from "./usePrReviewPanels";
import { createdCopyColumns } from "./prCopyColumns";
import {
  DEFAULT_REVIEW_PREVIEW_WIDTH,
  MAX_REVIEW_PREVIEW_WIDTH,
  MIN_REVIEW_PREVIEW_WIDTH,
} from "./myReviewsTypes";
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
import type {
  MyCreatedPullRequestSummary,
  ReviewPullRequestSummary,
} from "@/lib/azdoCommands";

const PREVIEW_LAYOUT_STORAGE_KEY = "azdodeck:layout:myPullRequestsPreview:dockview:v1";

/** The review panels take the review-inbox shape; an authored PR is always active. */
function toReviewSummary(pr: MyCreatedPullRequestSummary): ReviewPullRequestSummary {
  return {
    ...pr,
    createdBy: null,
    status: "active",
    myVote: 0,
    myVoteLabel: "No Vote",
    myIsRequired: false,
    mergeStatus: null,
    ciStatus: null,
    ciContext: null,
    ciCheckCount: 0,
  };
}

// One grid row. Memoized so that moving the selection or filtering the list
// only re-renders the rows whose own props actually changed. `onSelect` and
// the row `ref` callback are built here (not in the parent's map) so they stay
// stable per row instead of being recreated — and thus invalidating the memo —
// on every render.
const MemoCreatedPrRow = memo(function MemoCreatedPrRow({
  index,
  pr,
  columnTemplate,
  visibleColumns,
  selected,
  inMultiSelection,
  rowRefs,
  handleRowClick,
  setSelectedIndex,
}: {
  index: number;
  pr: MyCreatedPullRequestSummary;
  columnTemplate: string;
  visibleColumns: SortKey[];
  selected: boolean;
  inMultiSelection: boolean;
  rowRefs: React.RefObject<Array<HTMLDivElement | null>>;
  handleRowClick: (
    index: number,
    modifiers: { shiftKey: boolean; ctrlKey: boolean },
    setSelectedIndex: (index: number) => void,
  ) => void;
  setSelectedIndex: (index: number) => void;
}) {
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      rowRefs.current[index] = el;
    },
    [rowRefs, index],
  );

  const onSelect = useCallback(
    (modifiers: { shiftKey: boolean; ctrlKey: boolean }) =>
      handleRowClick(index, modifiers, setSelectedIndex),
    [handleRowClick, index, setSelectedIndex],
  );

  return (
    <CreatedPrRow
      ref={setRef}
      pr={pr}
      columnTemplate={columnTemplate}
      visibleColumns={visibleColumns}
      selected={selected}
      inMultiSelection={inMultiSelection}
      onSelect={onSelect}
    />
  );
});

// Active pull requests the authenticated user authored. Fetched live from Azure
// DevOps (not from the local sync cache), so data refreshes on view re-entry
// rather than via the sync:updated wiring the cached review grid uses. The grid
// layout, resizable/toggleable columns, sort headers, row styling, keyboard,
// and status bar mirror MyReviewsGrid, including the PR review panels docked
// to the right of the grid.
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
  const [maximized, setMaximized] = useState(false);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);

  const {
    template,
    minWidth: gridMinWidth,
    resetWidths,
    gridRef,
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

  const allPrs = useMemo(() => query.data?.pullRequests ?? [], [query.data]);

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
        void copyRowsAsTable(selection.selectedRows, createdCopyColumns(visibleColumns), setCopyToast);
      } else if (event.key === "Enter" && pr?.webUrl) {
        event.preventDefault();
        openExternalUrl(pr.webUrl);
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
      case "Enter":
      case "ArrowRight":
        event.preventDefault();
        focusPrimaryPreview();
        break;
      case "\\":
        event.preventDefault();
        setMaximized((value) => !value);
        break;
      case "Escape":
        if (selection.selectedKeys.size > 0) {
          event.preventDefault();
          selection.clear();
        }
        break;
      case "o":
      case "O":
        event.preventDefault();
        if (pr?.webUrl) openExternalUrl(pr.webUrl);
        break;
      case "c":
      case "C":
        event.preventDefault();
        if (pr?.webUrl) void navigator.clipboard?.writeText(pr.webUrl);
        break;
      case "l":
      case "L":
        event.preventDefault();
        if (pr?.webUrl) {
          void navigator.clipboard
            ?.writeText(markdownLink(`!${pr.pullRequestId} ${pr.title}`, pr.webUrl))
            .then(
              () => {
                setCopyToast("Markdown link copied");
                window.setTimeout(() => setCopyToast(null), 1500);
              },
              () => {
                setCopyToast("Copy failed");
                window.setTimeout(() => setCopyToast(null), 1500);
              },
            );
        }
        break;
      default:
        break;
    }
  };

  const selectedPr = useMemo(
    () => (rows[selectedIndex] ? toReviewSummary(rows[selectedIndex]) : null),
    [rows, selectedIndex],
  );
  const { anchor: reviewAnchor, secondary: reviewSecondary } = usePrReviewPanels({
    selectedPr,
    maximized,
    onToggleMaximize: () => setMaximized((value) => !value),
  });

  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const filterBar = useDockFilter(filterInputRef, () =>
    (rowRefs.current[selectedIndex] ?? rowRefs.current[0])?.focus(),
  );

  // The filter stays folded in the panel's tab strip until Ctrl+F or / opens it.
  const filterActions = (
        <DockFilterBar
          label="Filter pull requests"
          open={filterBar.open}
          onOpen={filterBar.onOpen}
          onClose={filterBar.onClose}
          inputRef={filterInputRef}
          hasValue={!!textFilter}
          chips={
            textFilter
              ? [{ label: `“${textFilter}”`, onEdit: filterBar.onOpen, onClear: () => setTextFilter("") }]
              : []
          }
        >
          <div className="w-56">
            <FilterAutocomplete
              compact
              value={textFilter}
              onChange={(value) => {
                setTextFilter(value);
                setSelectedIndex(0);
              }}
              onClear={() => setTextFilter("")}
              placeholder="Filter by repo, title, target…"
              suggestionPool={suggestionPool}
              ariaLabel="Filter pull requests"
              inputRef={filterInputRef}
            />
          </div>
        </DockFilterBar>
  );

  const gridPane = (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card">
      {query.data && query.data.warnings.length > 0 && (
        <p role="status" className="shrink-0 px-2 py-1 text-xs text-amber-600 dark:text-amber-400">
          Could not fetch {query.data.warnings.length} project(s): {query.data.warnings.join(", ")}.
        </p>
      )}
      {query.isLoading ? (
        <p className="px-2 py-3 text-sm text-muted-foreground">Loading…</p>
      ) : query.isError ? (
        <p className="px-2 py-3 text-sm text-destructive">{commandErrorMessage(query.error)}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto" onKeyDown={onKeyDown}>
          <div ref={gridRef} style={{ minWidth: gridMinWidth }}>
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
                  <MemoCreatedPrRow
                    key={`${pr.repositoryId}-${pr.pullRequestId}`}
                    index={index}
                    pr={pr}
                    columnTemplate={template}
                    visibleColumns={visibleColumns}
                    selected={index === selectedIndex}
                    inMultiSelection={selection.selectedKeys.has(
                      `${pr.repositoryId}:${pr.pullRequestId}`,
                    )}
                    rowRefs={rowRefs}
                    handleRowClick={selection.handleRowClick}
                    setSelectedIndex={setSelectedIndex}
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
    </div>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {copyToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 rounded-md bg-foreground px-3 py-2 text-sm text-background shadow-lg"
        >
          {copyToast}
        </div>
      )}
      <DockableWorkspace
        storageKey={PREVIEW_LAYOUT_STORAGE_KEY}
        panels={[
          {
            id: "grid",
            title: "Pull requests",
            minWidth: 480,
            headerActions: filterActions,
            content: gridPane,
          },
          {
            ...reviewAnchor,
            position: { relativeTo: "grid", direction: "right" },
            initialWidth: DEFAULT_REVIEW_PREVIEW_WIDTH,
            minWidth: MIN_REVIEW_PREVIEW_WIDTH,
            maxWidth: MAX_REVIEW_PREVIEW_WIDTH,
          },
          ...reviewSecondary,
        ] satisfies DockablePanelSpec[]}
        maximizedId={maximized ? "review" : undefined}
      />

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
          onAutoFitWidths={resetWidths}
          onClose={() => setColumnMenuRect(null)}
        />
      ) : null}
    </div>
  );
}
