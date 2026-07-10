import {
  type ReactNode,
  Fragment,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import {
  commandErrorMessage,
  listMyCreatedPullRequests,
  type MyCreatedPullRequestSummary,
} from "@/lib/azdoCommands";
import { useActiveOrganizationId } from "@/lib/useActiveConnection";
import {
  formatDate,
  formatRelativeDate,
  isEditableTarget,
  matchesAllSearchTerms,
  splitSearchTerms,
  type SortDirection,
} from "@/lib/utils";
import { FilterAutocomplete } from "@/components/FilterAutocomplete";
import { ColumnResizeHandle } from "@/components/ResizeHandle";
import { ColumnVisibilityMenu } from "@/components/ColumnVisibilityMenu";
import { useGridColumns } from "@/lib/useGridColumns";
import { useColumnVisibility } from "@/lib/useColumnVisibility";
import { openExternalUrl } from "@/lib/openExternal";

type SortKey =
  | "pullRequestId"
  | "repositoryName"
  | "title"
  | "creationDate"
  | "targetRefName"
  | "approvals";

type SortState = { key: SortKey; direction: SortDirection };

const sortLabels: Record<SortKey, string> = {
  pullRequestId: "PR#",
  repositoryName: "Repository",
  title: "Title",
  creationDate: "Created",
  targetRefName: "Target",
  approvals: "Approvals",
};

// Column order; the width arrays below are indexed by this list.
const GRID_KEYS: SortKey[] = [
  "pullRequestId",
  "repositoryName",
  "title",
  "creationDate",
  "targetRefName",
  "approvals",
];
const REQUIRED_COLUMNS: SortKey[] = ["pullRequestId", "title"];
const DEFAULT_COLUMN_WIDTHS = [52, 130, 220, 90, 120, 76];
const COLUMN_MIN_WIDTHS = [48, 96, 150, 72, 72, 60];
const COLUMN_MAX_WIDTHS = [120, 520, 960, 160, 240, 160];
const COLUMN_WIDTHS_STORAGE_KEY = "azdodeck:layout:myPullRequestsGridColumnWidths:v1";
const VISIBLE_COLUMNS_STORAGE_KEY = "azdodeck:view:myPullRequestsGridColumns:v1";

function defaultSortDirection(key: SortKey): SortDirection {
  return key === "creationDate" ? "desc" : "asc";
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function comparePrs(
  a: MyCreatedPullRequestSummary,
  b: MyCreatedPullRequestSummary,
  key: SortKey,
): number {
  switch (key) {
    case "pullRequestId":
      return a.pullRequestId - b.pullRequestId;
    case "repositoryName":
      return compareStrings(a.repositoryName, b.repositoryName);
    case "title":
      return compareStrings(a.title, b.title);
    case "creationDate":
      return a.creationDate.localeCompare(b.creationDate);
    case "targetRefName":
      return compareStrings(a.targetRefName, b.targetRefName);
    case "approvals":
      return a.approvals - b.approvals;
  }
}

function renderCell(key: SortKey, pr: MyCreatedPullRequestSummary): ReactNode {
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

function SortHeaderButton({
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

const CreatedPrRow = forwardRef<
  HTMLDivElement,
  {
    pr: MyCreatedPullRequestSummary;
    selected: boolean;
    columnTemplate: string;
    visibleColumns: SortKey[];
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
          if (pr.webUrl) openExternalUrl(pr.webUrl);
        }
      }}
      className={`grid cursor-pointer select-none items-center gap-2 border-b border-border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
        selected ? "bg-secondary" : "hover:bg-muted/50"
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

  const applySort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: defaultSortDirection(key) },
    );
  };

  const moveSelection = (next: number) => {
    const clamped = Math.max(0, Math.min(next, rows.length - 1));
    setSelectedIndex(clamped);
    rowRefs.current[clamped]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target)) return;
    const pr = rows[selectedIndex];
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
              <div role="grid" aria-label="My pull requests" tabIndex={-1}>
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
                    onSelect={() => setSelectedIndex(index)}
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
