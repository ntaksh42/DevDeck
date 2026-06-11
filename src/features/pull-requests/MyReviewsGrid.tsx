import {
  type CSSProperties,
  type ReactNode,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, FileText, Filter, Loader2, Search, X } from 'lucide-react';
import {
  listMyReviewPullRequests,
  getReviewResultPreview,
  getAppSettings,
  commandErrorMessage,
  type AppSettings,
  type Organization,
  type ReviewPullRequestSummary,
  type ReviewResultPreview,
} from '@/lib/azdoCommands';
import {

  matchesAllSearchTerms,
  splitSearchTerms,
  storedNumbers,
  storedNumber,
  gridColumnTemplate,
  isEditableTarget,
  formatDate,
  formatRelativeDate,
  focusPrimaryPreview,
  type SortDirection,
} from '@/lib/utils';
import { openExternalUrl } from '@/lib/openExternal';
import { activeArchivedKeys, toggleTriageArchived } from '@/lib/triage';
import { ShortcutHint } from '@/components/ShortcutHint';
import { ColumnResizeHandle, ResizeHandle } from '@/components/ResizeHandle';
import { LoadingState, ErrorState, PreviewEmptyState } from '@/components/StateDisplay';

const DEFAULT_REVIEW_PREVIEW_WIDTH = 420;
const MIN_REVIEW_PREVIEW_WIDTH = 280;
// Effectively unbounded: the pane is still capped by the window width.
const MAX_REVIEW_PREVIEW_WIDTH = 8192;
const REVIEW_PREVIEW_WIDTH_STORAGE_KEY = 'azdodeck:layout:reviewPreviewWidth';
const DEFAULT_PR_GRID_COLUMN_WIDTHS = [52, 110, 180, 82, 56, 76, 68, 78];
const PR_GRID_COLUMN_MIN_WIDTHS = [48, 96, 150, 72, 50, 68, 62, 70];
const PR_GRID_COLUMN_MAX_WIDTHS = [120, 520, 960, 240, 120, 240, 180, 240];
const PR_GRID_COLUMN_WIDTHS_STORAGE_KEY = 'azdodeck:layout:myReviewsGridColumnWidths:v2';
const PR_GRID_VIEW_STORAGE_KEY = "azdodeck:view:myReviewsGrid:v1";
const PR_GRID_ROW_HEIGHT = 29;
const PR_GRID_OVERSCAN = 8;
type VoteValue = -10 | -5 | 0 | 5 | 10 | number;

// Graphite-style inbox sections: rows group by what the reviewer has to do
// next, then sort by the user's column sort within each section.
type ReviewSection = "needsReview" | "waitingAuthor" | "approved" | "rejected" | "draft";

const REVIEW_SECTION_ORDER: ReviewSection[] = [
  "needsReview",
  "waitingAuthor",
  "approved",
  "rejected",
  "draft",
];

const REVIEW_SECTION_LABELS: Record<ReviewSection, string> = {
  needsReview: "Needs your review",
  waitingAuthor: "Waiting for author",
  approved: "Approved by you",
  rejected: "Rejected by you",
  draft: "Drafts",
};

function reviewSectionOf(pr: ReviewPullRequestSummary): ReviewSection {
  if (pr.isDraft) return "draft";
  if (pr.myVote === 10 || pr.myVote === 5) return "approved";
  if (pr.myVote === -5) return "waitingAuthor";
  if (pr.myVote === -10) return "rejected";
  return "needsReview";
}

type ReviewRow =
  | { kind: "header"; key: ReviewSection; label: string; count: number }
  | { kind: "pr"; pr: ReviewPullRequestSummary; prIndex: number };

function reviewTriageKey(pr: ReviewPullRequestSummary): string {
  return `${pr.repositoryId}:${pr.pullRequestId}`;
}

// Any visible change (vote, draft state, title) invalidates the snapshot and
// brings the PR back to the inbox.
function reviewTriageSnapshot(pr: ReviewPullRequestSummary): string {
  return `${pr.myVote}|${pr.isDraft}|${pr.title}|${pr.creationDate}`;
}

function VoteBadge({ vote, label }: { vote: VoteValue; label: string }) {
  const colors: Record<number, string> = {
    10: "bg-green-100 text-green-800 border-green-200",
    5: "bg-teal-100 text-teal-800 border-teal-200",
    0: "bg-gray-100 text-gray-600 border-gray-200",
    [-5]: "bg-yellow-100 text-yellow-800 border-yellow-200",
    [-10]: "bg-red-100 text-red-800 border-red-200",
  };
  const cls = colors[vote] ?? "bg-gray-100 text-gray-600 border-gray-200";
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function RequiredBadge({ required }: { required: boolean }) {
  return required ? (
    <span className="inline-flex items-center rounded border border-blue-200 bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800">
      Required
    </span>
  ) : (
    <span className="inline-flex items-center rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500">
      Optional
    </span>
  );
}

const ReviewPrRow = forwardRef<
  HTMLDivElement,
  {
    pr: ReviewPullRequestSummary;
    selected: boolean;
    columnTemplate: string;
    onSelect: () => void;
  }
>(({ pr, selected, columnTemplate, onSelect }, ref) => {
  const createdTime = new Date(pr.creationDate).getTime();
  const isStale = Number.isFinite(createdTime)
    ? Math.floor((Date.now() - createdTime) / 86_400_000) >= 3
    : false;
  return (
    <div
      ref={ref}
      tabIndex={selected ? 0 : -1}
      role="row"
      aria-selected={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return;
        }
        if (e.key === "Enter") {
          e.stopPropagation();
          if (e.ctrlKey && pr.webUrl) openExternalUrl(pr.webUrl);
          else focusPrimaryPreview();
        }
      }}
      className={`grid cursor-pointer select-none items-center gap-2 border-b border-border px-2 py-1 text-sm outline-none
        focus:ring-2 focus:ring-inset focus:ring-ring
        ${selected && isStale ? "bg-orange-100 dark:bg-orange-900/30"
          : selected ? "bg-secondary"
          : isStale ? "bg-orange-50 dark:bg-orange-950/20 hover:bg-orange-100/70"
          : "hover:bg-muted/50"}`}
      style={{ gridTemplateColumns: columnTemplate }}
    >
      {/* PR# */}
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

      {/* Repository */}
      <span className="truncate text-sm text-foreground" title={pr.repositoryName}>
        {pr.repositoryName}
      </span>

      {/* Title + Draft badge */}
      <div className="flex min-w-0 items-center gap-1.5">
        {pr.isDraft && (
          <span className="inline-flex shrink-0 items-center rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-500">
            Draft
          </span>
        )}
        <span className="truncate font-medium text-foreground" title={pr.title}>
          {pr.title}
        </span>
      </div>

      {/* Author */}
      <span className="truncate text-sm text-muted-foreground" title={pr.createdBy ?? "Unknown"}>
        {pr.createdBy ?? "Unknown"}
      </span>

      {/* Created */}
      <span
        className={`text-xs ${isStale ? "font-medium text-orange-600 dark:text-orange-400" : "text-muted-foreground"}`}
        title={formatDate(pr.creationDate)}
      >
        {formatRelativeDate(pr.creationDate)}
      </span>

      {/* Target branch */}
      <span className="truncate text-xs text-muted-foreground" title={pr.targetRefName}>
        {pr.targetRefName}
      </span>

      {/* Required / Optional */}
      <RequiredBadge required={pr.myIsRequired} />

      {/* Vote */}
      <VoteBadge vote={pr.myVote} label={pr.myVoteLabel} />
    </div>
  );
});
ReviewPrRow.displayName = "ReviewPrRow";

type VoteFilter = "noVote" | "approved" | "waitingAuthor" | "all";
type SortKey =
  | "pullRequestId"
  | "repositoryName"
  | "title"
  | "createdBy"
  | "creationDate"
  | "targetRefName"
  | "myIsRequired"
  | "myVote";
type SortState = {
  key: SortKey;
  direction: SortDirection;
};

const sortLabels: Record<SortKey, string> = {
  pullRequestId: "PR#",
  repositoryName: "Repository",
  title: "Title",
  createdBy: "Author",
  creationDate: "Created",
  targetRefName: "Target",
  myIsRequired: "Role",
  myVote: "My Vote",
};

function defaultSortDirection(key: SortKey): SortDirection {
  return key === "creationDate" ? "desc" : "asc";
}

function compareStrings(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });
}

function compareReviewPrs(
  a: ReviewPullRequestSummary,
  b: ReviewPullRequestSummary,
  key: SortKey,
): number {
  switch (key) {
    case "pullRequestId":
      return a.pullRequestId - b.pullRequestId;
    case "repositoryName":
      return compareStrings(a.repositoryName, b.repositoryName);
    case "title":
      return compareStrings(a.title, b.title);
    case "createdBy":
      return compareStrings(a.createdBy, b.createdBy);
    case "creationDate":
      {
        const left = new Date(a.creationDate).getTime();
        const right = new Date(b.creationDate).getTime();
        if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
        if (Number.isFinite(left)) return -1;
        if (Number.isFinite(right)) return 1;
        return compareStrings(a.creationDate, b.creationDate);
      }
    case "targetRefName":
      return compareStrings(a.targetRefName, b.targetRefName);
    case "myIsRequired":
      return Number(a.myIsRequired) - Number(b.myIsRequired);
    case "myVote":
      return a.myVote - b.myVote;
  }
}

function SortHeaderButton({
  column,
  sort,
  onSort,
  resizeHandle,
  filterActive,
  onFilterOpen,
}: {
  column: SortKey;
  sort: SortState;
  onSort: (column: SortKey) => void;
  resizeHandle?: ReactNode;
  filterActive?: boolean;
  onFilterOpen?: (anchorEl: HTMLButtonElement) => void;
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

type FilterableColumn =
  | "repositoryName"
  | "createdBy"
  | "targetRefName"
  | "myIsRequired"
  | "myVote";

const FILTERABLE_COLUMNS: Record<FilterableColumn, (pr: ReviewPullRequestSummary) => string> = {
  repositoryName: (pr) => pr.repositoryName,
  createdBy: (pr) => pr.createdBy ?? "Unknown",
  targetRefName: (pr) => pr.targetRefName,
  myIsRequired: (pr) => (pr.myIsRequired ? "Required" : "Optional"),
  myVote: (pr) => pr.myVoteLabel,
};

function isFilterableColumn(column: SortKey): column is FilterableColumn {
  return column in FILTERABLE_COLUMNS;
}

type MyReviewsGridViewState = {
  columnFilters: Partial<Record<FilterableColumn, Set<string>>>;
  organizationId: string;
  showDrafts: boolean;
  sort: SortState;
  textFilter: string;
  voteFilter: VoteFilter;
};

function defaultMyReviewsGridViewState(): MyReviewsGridViewState {
  return {
    columnFilters: {},
    organizationId: "",
    showDrafts: false,
    sort: { key: "creationDate", direction: "desc" },
    textFilter: "",
    voteFilter: "noVote",
  };
}

function loadMyReviewsGridViewState(): MyReviewsGridViewState {
  const fallback = defaultMyReviewsGridViewState();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PR_GRID_VIEW_STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    const sort =
      parsed.sort &&
      Object.keys(sortLabels).includes(parsed.sort.key) &&
      (parsed.sort.direction === "asc" || parsed.sort.direction === "desc")
        ? { key: parsed.sort.key as SortKey, direction: parsed.sort.direction as SortDirection }
        : fallback.sort;
    const voteFilter = voteFilterOptions.some((option) => option.value === parsed.voteFilter)
      ? (parsed.voteFilter as VoteFilter)
      : fallback.voteFilter;
    const columnFilters: Partial<Record<FilterableColumn, Set<string>>> = {};
    const parsedFilters = parsed.columnFilters;
    if (parsedFilters && typeof parsedFilters === "object" && !Array.isArray(parsedFilters)) {
      for (const column of Object.keys(FILTERABLE_COLUMNS) as FilterableColumn[]) {
        const values = parsedFilters[column];
        if (Array.isArray(values)) {
          const cleaned = values.filter((value): value is string => typeof value === "string");
          if (cleaned.length > 0) columnFilters[column] = new Set(cleaned);
        }
      }
    }
    return {
      columnFilters,
      organizationId: typeof parsed.organizationId === "string" ? parsed.organizationId : "",
      showDrafts: typeof parsed.showDrafts === "boolean" ? parsed.showDrafts : fallback.showDrafts,
      sort,
      textFilter: typeof parsed.textFilter === "string" ? parsed.textFilter : fallback.textFilter,
      voteFilter,
    };
  } catch {
    return fallback;
  }
}

function storeMyReviewsGridViewState(state: MyReviewsGridViewState) {
  const columnFilters: Partial<Record<FilterableColumn, string[]>> = {};
  for (const column of Object.keys(FILTERABLE_COLUMNS) as FilterableColumn[]) {
    const values = state.columnFilters[column];
    if (values && values.size > 0) columnFilters[column] = [...values];
  }
  window.localStorage.setItem(
    PR_GRID_VIEW_STORAGE_KEY,
    JSON.stringify({ ...state, columnFilters }),
  );
}

function activeColumnFilterCount(
  filters: Partial<Record<FilterableColumn, Set<string>>>,
): number {
  return (Object.values(filters) as (Set<string> | undefined)[]).filter(
    (values) => values && values.size > 0,
  ).length;
}

const voteFilterOptions: { value: VoteFilter; label: string }[] = [
  { value: "noVote", label: "No Vote" },
  { value: "waitingAuthor", label: "Waiting Author" },
  { value: "approved", label: "Approved" },
  { value: "all", label: "All" },
];

export function MyReviewsGrid({ organizations }: { organizations: Organization[] }) {
  const initialViewState = useMemo(() => loadMyReviewsGridViewState(), []);
  const [organizationId, setOrganizationId] = useState(() =>
    organizations.some((organization) => organization.id === initialViewState.organizationId)
      ? initialViewState.organizationId
      : organizations[0]?.id ?? "",
  );

  const query = useQuery({
    queryKey: ["myReviews", organizationId],
    queryFn: () => listMyReviewPullRequests({ organizationId }),
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
  });

  const [textFilter, setTextFilter] = useState(initialViewState.textFilter);
  const [voteFilter, setVoteFilter] = useState<VoteFilter>(initialViewState.voteFilter);
  const [showDrafts, setShowDrafts] = useState(initialViewState.showDrafts);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sort, setSort] = useState<SortState>(initialViewState.sort);
  const [columnFilters, setColumnFilters] = useState<Partial<Record<FilterableColumn, Set<string>>>>(
    initialViewState.columnFilters,
  );
  const [openFilterCol, setOpenFilterCol] = useState<FilterableColumn | null>(null);
  const [filterAnchorRect, setFilterAnchorRect] = useState<DOMRect | null>(null);
  const [columnWidths, setColumnWidths] = useState(() =>
    storedNumbers(
      PR_GRID_COLUMN_WIDTHS_STORAGE_KEY,
      DEFAULT_PR_GRID_COLUMN_WIDTHS,
      PR_GRID_COLUMN_MIN_WIDTHS,
      PR_GRID_COLUMN_MAX_WIDTHS,
    ),
  );
  const [previewWidth, setPreviewWidth] = useState(() =>
    storedNumber(
      REVIEW_PREVIEW_WIDTH_STORAGE_KEY,
      DEFAULT_REVIEW_PREVIEW_WIDTH,
      MIN_REVIEW_PREVIEW_WIDTH,
      MAX_REVIEW_PREVIEW_WIDTH,
    ),
  );
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const gridHadFocusRef = useRef(false);
  const [gridViewport, setGridViewport] = useState({ height: 0, scrollTop: 0 });

  useEffect(() => {
    localStorage.setItem(PR_GRID_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    if (!organizationId && organizations[0]) {
      setOrganizationId(organizations[0].id);
    }
  }, [organizationId, organizations]);

  useEffect(() => {
    storeMyReviewsGridViewState({
      columnFilters,
      organizationId,
      showDrafts,
      sort,
      textFilter,
      voteFilter,
    });
  }, [columnFilters, organizationId, showDrafts, sort, textFilter, voteFilter]);

  const allPrs = query.data ?? [];

  // Local "done" triage: archived PRs leave the inbox until they change.
  const [showDone, setShowDone] = useState(false);
  const [triageVersion, setTriageVersion] = useState(0);
  const triageScope = `myReviews:${organizationId || organizations[0]?.id || ""}`;
  const archivedKeys = useMemo(() => {
    const snapshots = new Map(
      allPrs.map((pr) => [reviewTriageKey(pr), reviewTriageSnapshot(pr)]),
    );
    return activeArchivedKeys(triageScope, snapshots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPrs, triageScope, triageVersion]);

  const baseFiltered = useMemo(() => {
    const terms = splitSearchTerms(textFilter);
    return allPrs.filter((pr) => {
      if (archivedKeys.has(reviewTriageKey(pr)) !== showDone) return false;
      if (!showDrafts && pr.isDraft) return false;
      if (!matchesAllSearchTerms(terms, [
        pr.pullRequestId,
        pr.repositoryName,
        pr.title,
        pr.createdBy,
        pr.targetRefName,
        pr.myVoteLabel,
      ]))
        return false;
      if (voteFilter === "noVote" && pr.myVote !== 0) return false;
      if (voteFilter === "approved" && pr.myVote !== 10 && pr.myVote !== 5) return false;
      if (voteFilter === "waitingAuthor" && pr.myVote !== -5) return false;
      return true;
    });
  }, [allPrs, archivedKeys, showDone, textFilter, voteFilter, showDrafts]);

  const columnUniqueValues = useMemo(() => {
    const map = {} as Record<FilterableColumn, string[]>;
    for (const col of Object.keys(FILTERABLE_COLUMNS) as FilterableColumn[]) {
      map[col] = [...new Set(baseFiltered.map(FILTERABLE_COLUMNS[col]))].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );
    }
    return map;
  }, [baseFiltered]);

  const filtered = useMemo(() => {
    const hasFilters = (Object.values(columnFilters) as (Set<string> | undefined)[]).some(
      (values) => values && values.size > 0,
    );
    if (!hasFilters) return baseFiltered;
    return baseFiltered.filter((pr) => {
      for (const col of Object.keys(columnFilters) as FilterableColumn[]) {
        const activeValues = columnFilters[col];
        if (!activeValues || activeValues.size === 0) continue;
        if (!activeValues.has(FILTERABLE_COLUMNS[col](pr))) return false;
      }
      return true;
    });
  }, [baseFiltered, columnFilters]);

  const sortedPrs = useMemo(() => {
    return filtered
      .map((pr, index) => ({ pr, index }))
      .sort((a, b) => {
        const sectionDelta =
          REVIEW_SECTION_ORDER.indexOf(reviewSectionOf(a.pr)) -
          REVIEW_SECTION_ORDER.indexOf(reviewSectionOf(b.pr));
        if (sectionDelta !== 0) return sectionDelta;
        const result = compareReviewPrs(a.pr, b.pr, sort.key);
        const directed = sort.direction === "asc" ? result : -result;
        return directed || a.index - b.index;
      })
      .map(({ pr }) => pr);
  }, [filtered, sort]);

  // Flattened row model with section headers, used by the virtualizer.
  const { reviewRows, prFlatIndexes } = useMemo(() => {
    const rows: ReviewRow[] = [];
    const flatIndexes: number[] = [];
    let currentSection: ReviewSection | null = null;
    sortedPrs.forEach((pr, prIndex) => {
      const section = reviewSectionOf(pr);
      if (section !== currentSection) {
        currentSection = section;
        rows.push({
          kind: "header",
          key: section,
          label: REVIEW_SECTION_LABELS[section],
          count: sortedPrs.filter((candidate) => reviewSectionOf(candidate) === section).length,
        });
      }
      flatIndexes[prIndex] = rows.length;
      rows.push({ kind: "pr", pr, prIndex });
    });
    return { reviewRows: rows, prFlatIndexes: flatIndexes };
  }, [sortedPrs]);

  const resultKeysSignature = useMemo(
    () => sortedPrs.map((pr) => `${pr.organizationId}-${pr.pullRequestId}`).join("|"),
    [sortedPrs],
  );

  const visiblePrs = allPrs.filter((pr) => showDrafts || !pr.isDraft);
  const noVoteCount = visiblePrs.filter((pr) => pr.myVote === 0).length;
  const columnFilterCount = activeColumnFilterCount(columnFilters);
  const activeFilterCount =
    (textFilter.trim() ? 1 : 0) + (voteFilter !== "all" ? 1 : 0) + columnFilterCount;
  const isFiltered = activeFilterCount > 0;
  const selectedPr = sortedPrs[selectedIndex] ?? null;

  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });

  const previewQuery = useQuery({
    queryKey: ["reviewResultPreview", selectedPr?.pullRequestId],
    queryFn: () => getReviewResultPreview({ pullRequestId: selectedPr?.pullRequestId ?? 0 }),
    enabled: !!selectedPr,
  });

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      REVIEW_PREVIEW_WIDTH_STORAGE_KEY,
      String(Math.round(previewWidth)),
    );
  }, [previewWidth]);

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(sortedPrs.length - 1, 0)));
  }, [sortedPrs.length]);

  // A background sync can replace or remove the focused row's DOM node; once
  // the grid had focus, restore it to the selected row after data changes so
  // keyboard navigation keeps working.
  useEffect(() => {
    if (!gridHadFocusRef.current) return;
    window.setTimeout(() => {
      rowRefs.current[selectedIndex]?.focus();
    }, 0);
  }, [selectedIndex, resultKeysSignature]);

  useEffect(() => {
    const scroller = gridScrollRef.current;
    if (!scroller) return;
    const scrollerElement = scroller;

    function updateViewport() {
      setGridViewport({
        height: scrollerElement.clientHeight,
        scrollTop: scrollerElement.scrollTop,
      });
    }

    updateViewport();
    scrollerElement.addEventListener("scroll", updateViewport, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateViewport);
    resizeObserver?.observe(scrollerElement);
    return () => {
      scrollerElement.removeEventListener("scroll", updateViewport);
      resizeObserver?.disconnect();
    };
  }, []);

  function applyVoteFilter(value: VoteFilter) {
    setVoteFilter(value);
    setSelectedIndex(0);
  }

  function focusRow(index: number) {
    rowRefs.current[index]?.focus();
  }

  function moveSelection(index: number) {
    const next = Math.max(0, Math.min(index, sortedPrs.length - 1));
    setSelectedIndex(next);
    const scroller = gridScrollRef.current;
    if (scroller) {
      const flatIndex = prFlatIndexes[next] ?? next;
      const rowTop = flatIndex * PR_GRID_ROW_HEIGHT;
      const rowBottom = rowTop + PR_GRID_ROW_HEIGHT;
      if (rowTop < scroller.scrollTop) {
        scroller.scrollTop = rowTop;
      } else if (rowBottom > scroller.scrollTop + scroller.clientHeight) {
        scroller.scrollTop = rowBottom - scroller.clientHeight;
      }
    }
    window.setTimeout(() => focusRow(next), 0);
  }

  function moveVoteFilter(delta: number) {
    const currentIndex = voteFilterOptions.findIndex((option) => option.value === voteFilter);
    const nextIndex = (currentIndex + delta + voteFilterOptions.length) % voteFilterOptions.length;
    applyVoteFilter(voteFilterOptions[nextIndex].value);
  }

  function openFilter(col: FilterableColumn, anchorEl: HTMLButtonElement) {
    setFilterAnchorRect(anchorEl.getBoundingClientRect());
    setOpenFilterCol(col);
  }

  function toggleFilter(col: FilterableColumn, value: string) {
    const allValues = columnUniqueValues[col] ?? [];
    setColumnFilters((prev) => {
      const current = prev[col];
      if (!current || current.size === 0) {
        const next = new Set(allValues.filter((candidate) => candidate !== value));
        if (next.size === 0) return prev;
        return { ...prev, [col]: next };
      }

      const next = new Set(current);
      if (next.has(value)) {
        next.delete(value);
        if (next.size === 0) {
          const { [col]: _, ...rest } = prev;
          return rest;
        }
      } else {
        next.add(value);
        if (next.size === allValues.length) {
          const { [col]: _, ...rest } = prev;
          return rest;
        }
      }
      return { ...prev, [col]: next };
    });
    setSelectedIndex(0);
  }

  function clearColumnFilter(col: FilterableColumn) {
    setColumnFilters((prev) => {
      const { [col]: _, ...rest } = prev;
      return rest;
    });
    setSelectedIndex(0);
  }

  function clearAllFilters() {
    setTextFilter("");
    setVoteFilter("all");
    setColumnFilters({});
    setOpenFilterCol(null);
    setFilterAnchorRect(null);
    setSelectedIndex(0);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const editable = isEditableTarget(e.target);
    const targetElement = e.target instanceof HTMLElement ? e.target : null;
    const buttonTarget = targetElement?.closest("button");

    if (editable) {
      if (e.key === "Escape") {
        e.preventDefault();
        setTextFilter("");
        setSelectedIndex(0);
        (e.target as HTMLElement).blur();
      } else if (e.key === "ArrowDown" && filtered.length > 0) {
        e.preventDefault();
        moveSelection(selectedIndex);
      }
      return;
    }

    if (buttonTarget?.closest('[role="tablist"]') && e.key === "ArrowRight") {
      e.preventDefault();
      moveVoteFilter(1);
      return;
    }
    if (buttonTarget?.closest('[role="tablist"]') && e.key === "ArrowLeft") {
      e.preventDefault();
      moveVoteFilter(-1);
      return;
    }
    if (buttonTarget && (e.key === "Enter" || e.key === " ")) {
      return;
    }

    // Single-letter shortcuts must not swallow app-level chords (Ctrl+K etc.).
    // Ctrl+Enter (open in browser) stays grid-handled.
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === "Enter") {
        e.preventDefault();
        const pr = sortedPrs[selectedIndex];
        if (pr?.webUrl) openExternalUrl(pr.webUrl);
      }
      return;
    }

    if (e.key === "/") {
      e.preventDefault();
      filterInputRef.current?.focus();
      filterInputRef.current?.select();
      return;
    }
    if (e.key === "1") {
      e.preventDefault();
      applyVoteFilter("noVote");
      return;
    }
    if (e.key === "2") {
      e.preventDefault();
      applyVoteFilter("waitingAuthor");
      return;
    }
    if (e.key === "3") {
      e.preventDefault();
      applyVoteFilter("approved");
      return;
    }
    if (e.key === "4") {
      e.preventDefault();
      applyVoteFilter("all");
      return;
    }
    if (e.key === "d" || e.key === "D") {
      e.preventDefault();
      setShowDrafts((value) => !value);
      setSelectedIndex(0);
      return;
    }
    if (e.key === "e" || e.key === "E") {
      e.preventDefault();
      const pr = sortedPrs[selectedIndex];
      if (pr) {
        toggleTriageArchived(triageScope, reviewTriageKey(pr), reviewTriageSnapshot(pr));
        setTriageVersion((value) => value + 1);
      }
      return;
    }
    if (e.key === "c" || e.key === "C") {
      e.preventDefault();
      const pr = sortedPrs[selectedIndex];
      if (pr?.webUrl) {
        void navigator.clipboard.writeText(pr.webUrl).then(
          () => { setCopyToast("URL copied"); setTimeout(() => setCopyToast(null), 1500); },
          () => { setCopyToast("Copy failed"); setTimeout(() => setCopyToast(null), 1500); },
        );
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (openFilterCol) {
        setOpenFilterCol(null);
        setFilterAnchorRect(null);
        return;
      }
      clearAllFilters();
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      moveVoteFilter(1);
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      moveVoteFilter(-1);
      return;
    }
    if (sortedPrs.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(selectedIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(selectedIndex - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveSelection(0);
    } else if (e.key === "End") {
      e.preventDefault();
      moveSelection(sortedPrs.length - 1);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      moveSelection(selectedIndex + 10);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      moveSelection(selectedIndex - 10);
    } else if (e.key === "Enter") {
      e.preventDefault();
      focusPrimaryPreview();
    }
  }

  function applySort(column: SortKey) {
    setSort((current) => {
      if (current.key !== column) {
        return { key: column, direction: defaultSortDirection(column) };
      }
      return { key: column, direction: current.direction === "asc" ? "desc" : "asc" };
    });
    setSelectedIndex(0);
  }

  const COLS = gridColumnTemplate(columnWidths, 2);
  const firstVirtualRow = Math.max(
    0,
    Math.floor(gridViewport.scrollTop / PR_GRID_ROW_HEIGHT) - PR_GRID_OVERSCAN,
  );
  const visibleRowCount = Math.ceil(
    Math.max(gridViewport.height, PR_GRID_ROW_HEIGHT) / PR_GRID_ROW_HEIGHT,
  );
  const lastVirtualRow = Math.min(
    reviewRows.length,
    firstVirtualRow + visibleRowCount + PR_GRID_OVERSCAN * 2,
  );
  const virtualRows = reviewRows.slice(firstVirtualRow, lastVirtualRow);
  const virtualTopPadding = firstVirtualRow * PR_GRID_ROW_HEIGHT;
  const virtualBottomPadding =
    Math.max(0, reviewRows.length - lastVirtualRow) * PR_GRID_ROW_HEIGHT;

  return (
    <div
      ref={containerRef}
      className="flex min-h-0 flex-1 flex-col gap-2 outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onFocusCapture={(event) => {
        const target = event.target;
        gridHadFocusRef.current =
          target instanceof HTMLElement &&
          Boolean(target.closest('[role="grid"], [role="row"]'));
      }}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (
          !(nextTarget instanceof HTMLElement) ||
          !nextTarget.closest('[role="grid"], [role="row"]')
        ) {
          gridHadFocusRef.current = false;
        }
      }}
    >
      {copyToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 rounded-md bg-foreground px-3 py-2 text-sm text-background shadow-lg"
        >
          {copyToast}
        </div>
      )}
      {/* Filter bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border bg-white px-3 py-2">
        {organizations.length > 1 && (
          <select
            value={organizationId}
            onChange={(e) => { setOrganizationId(e.target.value); setSelectedIndex(0); }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
            aria-label="Organization"
          >
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        )}
        {/* Text search */}
        <div className="flex h-8 flex-1 items-center rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
          <Search className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={filterInputRef}
            type="text"
            placeholder="Filter by repo, title, author…"
            value={textFilter}
            onChange={(e) => {
              setTextFilter(e.target.value);
              setSelectedIndex(0);
            }}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {textFilter && (
            <button
              type="button"
              onClick={() => setTextFilter("")}
              className="ml-1 rounded text-muted-foreground hover:text-foreground"
              aria-label="Clear filter"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Vote filter tabs */}
        <div
          className="flex items-center gap-0.5 rounded-md border border-border bg-gray-50 p-0.5"
          role="tablist"
          aria-label="Vote filter"
        >
          {voteFilterOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                applyVoteFilter(opt.value);
              }}
              role="tab"
              aria-selected={voteFilter === opt.value}
              aria-pressed={voteFilter === opt.value}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                voteFilter === opt.value
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Draft checkbox */}
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showDrafts}
            onChange={(e) => {
              setShowDrafts(e.target.checked);
              setSelectedIndex(0);
            }}
            className="h-3.5 w-3.5 rounded border-gray-300"
          />
          Show Drafts
        </label>

      </div>

      <div
        className="grid min-h-0 flex-1 items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_8px_minmax(280px,var(--review-preview-width))]"
        style={{ "--review-preview-width": `${previewWidth}px` } as CSSProperties}
      >
        {/* Grid */}
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-white">
          <div ref={gridScrollRef} className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[720px]">
              {/* Column headers */}
              <div
                role="row"
                className="grid items-center gap-2 border-b border-border bg-gray-50 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                style={{ gridTemplateColumns: COLS }}
              >
                {(["pullRequestId", "repositoryName", "title", "createdBy", "creationDate", "targetRefName", "myIsRequired"] as SortKey[]).map((col, i) => (
                  <SortHeaderButton
                    key={col}
                    column={col}
                    sort={sort}
                    onSort={applySort}
                    filterActive={isFilterableColumn(col) && !!columnFilters[col]?.size}
                    onFilterOpen={isFilterableColumn(col) ? (el) => openFilter(col, el) : undefined}
                    resizeHandle={
                      <ColumnResizeHandle
                        columnIndex={i}
                        widths={columnWidths}
                        setWidths={setColumnWidths}
                        min={PR_GRID_COLUMN_MIN_WIDTHS[i]}
                        max={PR_GRID_COLUMN_MAX_WIDTHS[i]}
                      />
                    }
                  />
                ))}
                <SortHeaderButton
                  column="myVote"
                  sort={sort}
                  onSort={applySort}
                  filterActive={!!columnFilters.myVote?.size}
                  onFilterOpen={(el) => openFilter("myVote", el)}
                />
              </div>

              {query.isLoading ? (
                <LoadingState />
              ) : query.isError ? (
                <ErrorState message={commandErrorMessage(query.error)} />
              ) : sortedPrs.length === 0 ? (
                <div className="flex min-h-24 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                  <span>
                    {allPrs.length === 0 ? "No pull requests assigned to you." : "No results match the current filter."}
                  </span>
                  {isFiltered ? (
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      className="rounded border border-border px-2 py-0.5 text-xs hover:bg-secondary"
                    >
                      Clear filters
                    </button>
                  ) : null}
                </div>
              ) : (
                <div
                  role="grid"
                  aria-label="My review pull requests"
                  data-primary-grid="true"
                  tabIndex={-1}
                >
                  {virtualTopPadding > 0 ? (
                    <div style={{ height: virtualTopPadding }} />
                  ) : null}
                  {virtualRows.map((row) => {
                    if (row.kind === "header") {
                      return (
                        <div
                          key={`header:${row.key}`}
                          role="presentation"
                          className="flex h-[29px] items-center gap-1.5 border-b border-border bg-muted/60 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          {row.label}
                          <span className="font-normal normal-case">({row.count})</span>
                        </div>
                      );
                    }
                    return (
                      <ReviewPrRow
                        key={`${row.pr.organizationId}-${row.pr.pullRequestId}`}
                        ref={(el) => { rowRefs.current[row.prIndex] = el; }}
                        columnTemplate={COLS}
                        pr={row.pr}
                        selected={row.prIndex === selectedIndex}
                        onSelect={() => setSelectedIndex(row.prIndex)}
                      />
                    );
                  })}
                  {virtualBottomPadding > 0 ? (
                    <div style={{ height: virtualBottomPadding }} />
                  ) : null}
                </div>
              )}
            </div>
          </div>

          {/* Status bar */}
          <div className="flex items-center justify-between border-t border-border px-2 py-1 text-xs text-muted-foreground">
            <span>
              {visiblePrs.length} total,{" "}
              <span className="font-medium text-foreground">{noVoteCount}</span> not voted
            </span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                aria-pressed={showDone}
                title="Toggle done view (E marks the selected row done)"
                onClick={() => {
                  setShowDone((value) => !value);
                  setSelectedIndex(0);
                }}
                className={`rounded border px-2 py-0.5 text-xs ${
                  showDone
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-white hover:bg-secondary"
                }`}
              >
                {showDone ? "Back to inbox" : `Done (${archivedKeys.size})`}
              </button>
              {isFiltered ? (
                <>
                  <span>{activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active</span>
                  <span>{sortedPrs.length} shown</span>
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="rounded border border-border bg-white px-2 py-0.5 text-xs hover:bg-secondary"
                  >
                    Clear filters
                  </button>
                </>
              ) : null}
              <ShortcutHint>Alt+G</ShortcutHint>
            </span>
          </div>
        </div>

        <ResizeHandle
          ariaLabel="Resize review preview"
          className="hidden xl:flex"
          direction={-1}
          max={MAX_REVIEW_PREVIEW_WIDTH}
          min={MIN_REVIEW_PREVIEW_WIDTH}
          onChange={setPreviewWidth}
          onReset={() => setPreviewWidth(DEFAULT_REVIEW_PREVIEW_WIDTH)}
          value={previewWidth}
        />

        <ReviewResultPreviewPanel
          selectedPr={selectedPr}
          settings={settingsQuery.data ?? null}
          settingsLoading={settingsQuery.isLoading}
          preview={previewQuery.data ?? null}
          previewLoading={previewQuery.isFetching}
          previewError={previewQuery.isError ? commandErrorMessage(previewQuery.error) : null}
        />
      </div>
      {openFilterCol && filterAnchorRect ? (
        <ColumnFilterDropdown
          anchorRect={filterAnchorRect}
          allValues={columnUniqueValues[openFilterCol] ?? []}
          activeValues={columnFilters[openFilterCol]}
          onToggle={(value) => toggleFilter(openFilterCol, value)}
          onClearAll={() => clearColumnFilter(openFilterCol)}
          onClose={() => {
            setOpenFilterCol(null);
            setFilterAnchorRect(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ColumnFilterDropdown({
  anchorRect,
  allValues,
  activeValues,
  onToggle,
  onClearAll,
  onClose,
}: {
  anchorRect: DOMRect;
  allValues: string[];
  activeValues: Set<string> | undefined;
  onToggle: (value: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!dropdownRef.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const isAllChecked = !activeValues || activeValues.size === 0;
  const filteredValues = search.trim()
    ? allValues.filter((value) => value.toLowerCase().includes(search.trim().toLowerCase()))
    : allValues;
  const top = Math.min(anchorRect.bottom + 2, window.innerHeight - 280);
  const left = Math.min(anchorRect.left, window.innerWidth - 208);

  return (
    <div
      ref={dropdownRef}
      className="fixed z-50 w-52 rounded-md border border-border bg-white shadow-lg"
      style={{ top, left }}
    >
      <div className="border-b border-border p-1.5">
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="w-full rounded border border-input bg-background px-2 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="border-b border-border p-1">
        <button
          type="button"
          onClick={onClearAll}
          className={`w-full rounded px-2 py-0.5 text-left text-xs hover:bg-secondary ${
            isAllChecked ? "font-medium text-foreground" : "text-muted-foreground"
          }`}
        >
          (All)
        </button>
      </div>
      <div className="max-h-44 overflow-auto p-1">
        {filteredValues.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">No values</p>
        ) : (
          filteredValues.map((value) => {
            const checked = isAllChecked || (activeValues?.has(value) ?? false);
            return (
              <label
                key={value}
                className="flex cursor-pointer select-none items-center gap-1.5 rounded px-2 py-0.5 text-xs hover:bg-secondary"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(value)}
                  className="h-3 w-3"
                />
                <span className="truncate">{value || "(empty)"}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

function ReviewResultPreviewPanel({
  selectedPr,
  settings,
  settingsLoading,
  preview,
  previewLoading,
  previewError,
}: {
  selectedPr: ReviewPullRequestSummary | null;
  settings: AppSettings | null;
  settingsLoading: boolean;
  preview: ReviewResultPreview | null;
  previewLoading: boolean;
  previewError: string | null;
}) {
  const hasFolder = !!settings?.reviewResultFolderPath;

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-white focus-within:ring-2 focus-within:ring-ring">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">Review Preview</h2>
            <p className="truncate text-xs text-muted-foreground">
              {selectedPr ? `PR${selectedPr.pullRequestId}` : "No PR selected"}
            </p>
          </div>
        </div>
        {previewLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <ShortcutHint>Alt+P</ShortcutHint>
        )}
      </div>

      {settingsLoading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading
        </div>
      ) : !selectedPr ? (
        <PreviewEmptyState message="Select a pull request." />
      ) : !hasFolder ? (
        <PreviewEmptyState message="Review result folder is not configured." />
      ) : previewError ? (
        <div className="m-3 rounded-md border border-destructive/30 bg-red-50 p-3 text-sm text-destructive">
          {previewError}
        </div>
      ) : preview ? (
        <>
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-xs font-medium" title={preview.fileName}>
              {preview.fileName}
            </p>
            <p className="truncate text-xs text-muted-foreground" title={preview.filePath}>
              {preview.filePath}
            </p>
          </div>
          <iframe
            title={`Review result preview for PR${preview.pullRequestId}`}
            aria-keyshortcuts="Alt+P"
            sandbox=""
            srcDoc={preview.html}
            className="min-h-0 flex-1 bg-white outline-none"
            data-primary-preview="true"
            tabIndex={-1}
          />
        </>
      ) : (
        <PreviewEmptyState message={`No HTML file matched PR${selectedPr.pullRequestId}.`} />
      )}
    </aside>
  );
}
