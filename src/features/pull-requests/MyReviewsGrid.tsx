import {
  type CSSProperties,
  type ReactNode,
  Fragment,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleDashed,
  Filter,
  Loader,
  Search,
  X,
  XCircle,
} from 'lucide-react';
import {
  getAppSettings,
  listMyReviewPullRequests,
  listPullRequestChanges,
  commandErrorMessage,
  prLocator,
  snoozeItem,
  submitPullRequestVote,
  DEFAULT_REVIEW_STALE_THRESHOLD_DAYS,
  type Organization,
  type ReviewPullRequestSummary,
} from '@/lib/azdoCommands';
import { detectFileOverlaps } from '@/lib/prOverlap';
import { SnoozeMenu } from '@/components/SnoozeMenu';
import { SnoozedItemsPanel } from '@/components/SnoozedItemsPanel';
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
import { recordRecentPullRequest } from '@/lib/recentItems';
import { isTauriRuntime } from '@/lib/runtime';
import {
  acknowledgeReturn,
  reconcileReturns,
  seedDemoReturn,
} from './reviewReturnTracking';
import { activeArchivedKeys, toggleTriageArchived } from '@/lib/triage';
import { ColumnResizeHandle, ResizeHandle } from '@/components/ResizeHandle';
import { ColumnVisibilityMenu } from '@/components/ColumnVisibilityMenu';
import { LoadingState, ErrorState } from '@/components/StateDisplay';
import { ActiveFilters } from '@/components/ActiveFilters';

import { PrReviewPanel } from './PrReviewPanel';
import { VOTE_BADGE_CLASSES, voteTone } from './voteVisual';

const DEFAULT_REVIEW_PREVIEW_WIDTH = 420;
const MIN_REVIEW_PREVIEW_WIDTH = 280;
// Effectively unbounded: the pane is still capped by the window width.
const MAX_REVIEW_PREVIEW_WIDTH = 8192;
const REVIEW_PREVIEW_WIDTH_STORAGE_KEY = 'azdodeck:layout:reviewPreviewWidth';
const DEFAULT_PR_GRID_COLUMN_WIDTHS = [52, 36, 110, 180, 82, 56, 64, 76, 68, 78];
const PR_GRID_COLUMN_MIN_WIDTHS = [48, 32, 96, 150, 72, 50, 52, 68, 62, 70];
const PR_GRID_COLUMN_MAX_WIDTHS = [120, 60, 520, 960, 240, 120, 120, 240, 180, 240];
const PR_GRID_COLUMN_WIDTHS_STORAGE_KEY = 'azdodeck:layout:myReviewsGridColumnWidths:v4';
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
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${VOTE_BADGE_CLASSES[voteTone(vote)]}`}
    >
      {label}
    </span>
  );
}

function RequiredBadge({ required }: { required: boolean }) {
  return required ? (
    <span className="inline-flex items-center rounded border border-blue-200 bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
      Required
    </span>
  ) : (
    <span className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
      Optional
    </span>
  );
}

// Compact CI verdict cell. Icon-only to keep the column minimal; the full
// pipeline/status detail lives in the native tooltip. An unknown/none verdict
// renders a muted dash so a missing CI fetch never reads as a failure.
function CiBadge({ pr }: { pr: ReviewPullRequestSummary }) {
  const status = pr.ciStatus ?? "none";
  const contextLabel = pr.ciContext ? pr.ciContext : "—";
  const statusLabel =
    status === "succeeded"
      ? "Succeeded"
      : status === "failed"
        ? "Failed"
        : status === "in_progress"
          ? "In progress"
          : "Not run";
  const tooltip = `Pipeline: ${contextLabel} | Status: ${statusLabel} | ${pr.ciCheckCount} check${pr.ciCheckCount === 1 ? "" : "s"}`;

  let icon: ReactNode;
  if (status === "succeeded") {
    icon = <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" aria-hidden="true" />;
  } else if (status === "failed") {
    icon = <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" aria-hidden="true" />;
  } else if (status === "in_progress") {
    icon = <Loader className="h-3.5 w-3.5 animate-spin text-amber-500 dark:text-amber-400" aria-hidden="true" />;
  } else {
    icon = <CircleDashed className="h-3.5 w-3.5 text-muted-foreground/50" aria-hidden="true" />;
  }

  return (
    <span
      className="flex items-center justify-center"
      title={tooltip}
      aria-label={`CI ${statusLabel}`}
      role="img"
    >
      {icon}
    </span>
  );
}

// Renders a single grid cell for the given column key. Cells stay direct grid
// items (wrapped only in a keyed Fragment) so the column template lines up.
// Whole days a PR has been open (review age), or null when the creation date
// is unparseable. Negative ages (clock skew) clamp to 0.
export function reviewAgeDays(
  creationDate: string,
  now: number = Date.now(),
): number | null {
  const created = new Date(creationDate).getTime();
  if (!Number.isFinite(created)) return null;
  return Math.max(0, Math.floor((now - created) / 86_400_000));
}

function renderPrCell(
  key: SortKey,
  pr: ReviewPullRequestSummary,
  isStale: boolean,
  returned: boolean,
): ReactNode {
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
          {returned ? (
            <span
              className="inline-flex shrink-0 items-center rounded border border-purple-300 bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-800 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300"
              title="The author pushed new changes after your review — returned to you"
            >
              Returned
            </span>
          ) : null}
          {pr.isDraft && (
            <span className="inline-flex shrink-0 items-center rounded border border-input bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              Draft
            </span>
          )}
          <span className="truncate font-medium text-foreground" title={pr.title}>
            {pr.title}
          </span>
          {pr.mergeStatus === "conflicts" ? (
            <span
              className="inline-flex shrink-0 items-center rounded border border-red-200 bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
              title="This pull request has merge conflicts"
            >
              Conflicts
            </span>
          ) : null}
        </div>
      );
    case "createdBy":
      return (
        <span className="truncate text-sm text-muted-foreground" title={pr.createdBy ?? "Unknown"}>
          {pr.createdBy ?? "Unknown"}
        </span>
      );
    case "creationDate":
      return (
        <span
          className={`text-xs ${isStale ? "font-medium text-orange-600 dark:text-orange-400" : "text-muted-foreground"}`}
          title={formatDate(pr.creationDate)}
        >
          {formatRelativeDate(pr.creationDate)}
        </span>
      );
    case "reviewAge": {
      const days = reviewAgeDays(pr.creationDate);
      return (
        <span
          className={`text-xs tabular-nums ${isStale ? "font-medium text-orange-600 dark:text-orange-400" : "text-muted-foreground"}`}
          title={
            days === null
              ? "Review age unavailable"
              : `Open for ${days} day${days === 1 ? "" : "s"} (since ${formatDate(pr.creationDate)})`
          }
        >
          {days === null ? "—" : `${days}d`}
        </span>
      );
    }
    case "targetRefName":
      return (
        <span className="truncate text-xs text-muted-foreground" title={pr.targetRefName}>
          {pr.targetRefName}
        </span>
      );
    case "myIsRequired":
      return <RequiredBadge required={pr.myIsRequired} />;
    case "myVote":
      return <VoteBadge vote={pr.myVote} label={pr.myVoteLabel} />;
    case "ciStatus":
      return <CiBadge pr={pr} />;
  }
}

const ReviewPrRow = forwardRef<
  HTMLDivElement,
  {
    pr: ReviewPullRequestSummary;
    selected: boolean;
    inMultiSelection: boolean;
    returned: boolean;
    columnTemplate: string;
    visibleColumns: SortKey[];
    staleThresholdDays: number;
    onSelect: (event: { shiftKey: boolean }) => void;
  }
>(({ pr, selected, inMultiSelection, returned, columnTemplate, visibleColumns, staleThresholdDays, onSelect }, ref) => {
  const createdTime = new Date(pr.creationDate).getTime();
  const isStale = Number.isFinite(createdTime)
    ? Math.floor((Date.now() - createdTime) / 86_400_000) >= staleThresholdDays
    : false;
  return (
    <div
      ref={ref}
      tabIndex={selected ? 0 : -1}
      role="row"
      aria-selected={selected || inMultiSelection}
      onClick={(e) => onSelect({ shiftKey: e.shiftKey })}
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
          : inMultiSelection ? "bg-primary/10"
          : isStale ? "bg-orange-50 dark:bg-orange-950/20 hover:bg-orange-100/70"
          : "hover:bg-muted/50"}`}
      style={{ gridTemplateColumns: columnTemplate }}
    >
      {visibleColumns.map((key) => (
        <Fragment key={key}>{renderPrCell(key, pr, isStale, returned)}</Fragment>
      ))}
    </div>
  );
});
ReviewPrRow.displayName = "ReviewPrRow";

type SortKey =
  | "pullRequestId"
  | "ciStatus"
  | "repositoryName"
  | "title"
  | "createdBy"
  | "creationDate"
  | "reviewAge"
  | "targetRefName"
  | "myIsRequired"
  | "myVote";
type SortState = {
  key: SortKey;
  direction: SortDirection;
};

const sortLabels: Record<SortKey, string> = {
  pullRequestId: "PR#",
  ciStatus: "CI",
  repositoryName: "Repository",
  title: "Title",
  createdBy: "Author",
  creationDate: "Created",
  reviewAge: "Review age",
  targetRefName: "Target",
  myIsRequired: "Role",
  myVote: "My Vote",
};

// Column order matches the width arrays; PR# and Title can never be hidden.
const PR_GRID_KEYS: SortKey[] = [
  "pullRequestId",
  "ciStatus",
  "repositoryName",
  "title",
  "createdBy",
  "creationDate",
  "reviewAge",
  "targetRefName",
  "myIsRequired",
  "myVote",
];
const PR_GRID_REQUIRED_COLUMNS: SortKey[] = ["pullRequestId", "title"];

function loadVisibleColumns(value: unknown): SortKey[] {
  if (!Array.isArray(value)) return [...PR_GRID_KEYS];
  const set = new Set(value.filter((v): v is SortKey => PR_GRID_KEYS.includes(v as SortKey)));
  for (const required of PR_GRID_REQUIRED_COLUMNS) set.add(required);
  const ordered = PR_GRID_KEYS.filter((key) => set.has(key));
  return ordered.length > 0 ? ordered : [...PR_GRID_KEYS];
}

function defaultSortDirection(key: SortKey): SortDirection {
  // Created (newest first) and Review age (oldest/longest-waiting first) both
  // default to descending.
  return key === "creationDate" || key === "reviewAge" ? "desc" : "asc";
}

function compareStrings(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });
}

// Ordering for the CI column: ascending sort surfaces failures first so a
// reviewer can spot merge blockers, then in-progress, success, and unknown.
function ciSortRank(status: string | null): number {
  switch (status) {
    case "failed":
      return 0;
    case "in_progress":
      return 1;
    case "succeeded":
      return 2;
    default:
      return 3;
  }
}

function compareReviewPrs(
  a: ReviewPullRequestSummary,
  b: ReviewPullRequestSummary,
  key: SortKey,
): number {
  switch (key) {
    case "pullRequestId":
      return a.pullRequestId - b.pullRequestId;
    case "ciStatus":
      return ciSortRank(a.ciStatus) - ciSortRank(b.ciStatus);
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
    case "reviewAge":
      {
        // Sort by age ascending (youngest first); descending surfaces the
        // longest-waiting reviews. Age = now - creation, so this is the
        // creation-time comparison reversed.
        const left = new Date(a.creationDate).getTime();
        const right = new Date(b.creationDate).getTime();
        if (Number.isFinite(left) && Number.isFinite(right)) return right - left;
        if (Number.isFinite(left)) return -1;
        if (Number.isFinite(right)) return 1;
        return compareStrings(b.creationDate, a.creationDate);
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
  collapsedSections: Set<ReviewSection>;
  columnFilters: Partial<Record<FilterableColumn, Set<string>>>;
  organizationId: string;
  showDrafts: boolean;
  sort: SortState;
  textFilter: string;
  visibleColumns: SortKey[];
};

// Everything except the actionable "Needs your review" section starts folded,
// preserving the old "focus on what needs a vote" default without a filter.
const DEFAULT_COLLAPSED_SECTIONS: ReviewSection[] = [
  "waitingAuthor",
  "approved",
  "rejected",
  "draft",
];

function defaultMyReviewsGridViewState(): MyReviewsGridViewState {
  return {
    collapsedSections: new Set(DEFAULT_COLLAPSED_SECTIONS),
    columnFilters: {},
    organizationId: "",
    showDrafts: false,
    sort: { key: "creationDate", direction: "desc" },
    textFilter: "",
    visibleColumns: [...PR_GRID_KEYS],
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
    const collapsedSections = Array.isArray(parsed.collapsedSections)
      ? new Set(
          (parsed.collapsedSections as unknown[]).filter(
            (value): value is ReviewSection =>
              REVIEW_SECTION_ORDER.includes(value as ReviewSection),
          ),
        )
      : fallback.collapsedSections;
    const columnFilters: Partial<Record<FilterableColumn, Set<string>>> = {};
    const parsedFilters = parsed.columnFilters;
    if (parsedFilters && typeof parsedFilters === "object" && !Array.isArray(parsedFilters)) {
      for (const column of Object.keys(FILTERABLE_COLUMNS) as FilterableColumn[]) {
        const values = parsedFilters[column];
        if (Array.isArray(values)) {
          // An empty array is a persisted "uncheck all" selection, so keep the
          // key (with an empty set) rather than dropping it to "(All)".
          const cleaned = values.filter((value): value is string => typeof value === "string");
          columnFilters[column] = new Set(cleaned);
        }
      }
    }
    return {
      collapsedSections,
      columnFilters,
      organizationId: typeof parsed.organizationId === "string" ? parsed.organizationId : "",
      showDrafts: typeof parsed.showDrafts === "boolean" ? parsed.showDrafts : fallback.showDrafts,
      sort,
      textFilter: typeof parsed.textFilter === "string" ? parsed.textFilter : fallback.textFilter,
      visibleColumns: loadVisibleColumns(parsed.visibleColumns),
    };
  } catch {
    return fallback;
  }
}

function storeMyReviewsGridViewState(state: MyReviewsGridViewState) {
  const columnFilters: Partial<Record<FilterableColumn, string[]>> = {};
  for (const column of Object.keys(FILTERABLE_COLUMNS) as FilterableColumn[]) {
    const values = state.columnFilters[column];
    // Persist empty sets too: an empty set is an explicit "uncheck all" filter,
    // distinct from an absent key which means "(All)".
    if (values) columnFilters[column] = [...values];
  }
  window.localStorage.setItem(
    PR_GRID_VIEW_STORAGE_KEY,
    JSON.stringify({
      ...state,
      columnFilters,
      collapsedSections: [...state.collapsedSections],
    }),
  );
}

function activeColumnFilterCount(
  filters: Partial<Record<FilterableColumn, Set<string>>>,
): number {
  // An absent key means "(All)"; an empty set means "uncheck all" (an explicit
  // selection of nothing), so both are counted as an active column filter.
  return (Object.values(filters) as (Set<string> | undefined)[]).filter(
    (values) => values !== undefined,
  ).length;
}

export type MyReviewsSelectRequest = {
  pullRequestId: number;
  repositoryId: string | null;
  organizationId?: string;
  requestId: number;
};

type MyReviewsGridProps = {
  organizations: Organization[];
  selectRequest?: MyReviewsSelectRequest | null;
  onSelectRequestHandled?: () => void;
};

export function MyReviewsGrid({
  organizations,
  selectRequest,
  onSelectRequestHandled,
}: MyReviewsGridProps) {
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

  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const staleThresholdDays =
    settingsQuery.data?.reviewStaleThresholdDays ??
    DEFAULT_REVIEW_STALE_THRESHOLD_DAYS;

  const queryClient = useQueryClient();
  const voteMutation = useMutation({
    mutationFn: submitPullRequestVote,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["myReviews", organizationId] });
    },
  });

  const [showSnoozed, setShowSnoozed] = useState(false);
  const [snoozeAnchorRect, setSnoozeAnchorRect] = useState<DOMRect | null>(null);
  // Captured when the snooze menu opens so the action targets the row the user
  // had selected, even if selection changes while the menu is open.
  const snoozeTargetRef = useRef<ReviewPullRequestSummary | null>(null);
  const snoozeMutation = useMutation({
    mutationFn: snoozeItem,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["myReviews"] });
      void queryClient.invalidateQueries({
        queryKey: ["snoozedItems", "pull_request"],
      });
    },
  });

  const [textFilter, setTextFilter] = useState(initialViewState.textFilter);
  const [collapsedSections, setCollapsedSections] = useState<Set<ReviewSection>>(
    initialViewState.collapsedSections,
  );
  const [showDrafts, setShowDrafts] = useState(initialViewState.showDrafts);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Multi-selection for conflict-risk overlap checks. Keys are PR triage keys
  // (`repositoryId:pullRequestId`); the anchor is where a Shift-extend started.
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [overlapPopupOpen, setOverlapPopupOpen] = useState(false);
  const overlapButtonRef = useRef<HTMLButtonElement | null>(null);
  const [sort, setSort] = useState<SortState>(initialViewState.sort);
  const [columnFilters, setColumnFilters] = useState<Partial<Record<FilterableColumn, Set<string>>>>(
    initialViewState.columnFilters,
  );
  const [openFilterCol, setOpenFilterCol] = useState<FilterableColumn | null>(null);
  const [filterAnchorRect, setFilterAnchorRect] = useState<DOMRect | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<SortKey[]>(
    initialViewState.visibleColumns,
  );
  const [columnMenuRect, setColumnMenuRect] = useState<DOMRect | null>(null);
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
  const [maximized, setMaximized] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const gridHadFocusRef = useRef(false);
  // A cross-link select request that is waiting for the target PR to appear in
  // the sorted/visible rows (e.g. after switching org or loading data).
  const pendingSelectRef = useRef<MyReviewsSelectRequest | null>(null);
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
      collapsedSections,
      columnFilters,
      organizationId,
      showDrafts,
      sort,
      textFilter,
      visibleColumns,
    });
  }, [collapsedSections, columnFilters, organizationId, showDrafts, sort, textFilter, visibleColumns]);

  const allPrs = query.data ?? [];

  // "Returned to me": PRs whose vote was reset (author pushed) after I reviewed.
  // Tracked locally by diffing successive vote snapshots.
  const [returnedKeys, setReturnedKeys] = useState<Set<string>>(new Set());
  const demoSeededRef = useRef(false);
  const voteSignature = useMemo(
    () => allPrs.map((pr) => `${reviewTriageKey(pr)}:${pr.myVote}`).join("|"),
    [allPrs],
  );
  useEffect(() => {
    // Seed one demo PR as returned so the feature is reproducible in the
    // browser preview without a live vote-reset.
    if (!demoSeededRef.current && !isTauriRuntime()) {
      demoSeededRef.current = true;
      const candidate = allPrs.find((pr) => pr.myVote === 0 && !pr.isDraft);
      if (candidate) seedDemoReturn(reviewTriageKey(candidate));
    }
    setReturnedKeys(
      reconcileReturns(
        allPrs.map((pr) => ({ key: reviewTriageKey(pr), myVote: pr.myVote })),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voteSignature]);

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
      return true;
    });
  }, [allPrs, archivedKeys, showDone, textFilter, showDrafts]);

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
      (values) => values !== undefined,
    );
    if (!hasFilters) return baseFiltered;
    return baseFiltered.filter((pr) => {
      for (const col of Object.keys(columnFilters) as FilterableColumn[]) {
        const activeValues = columnFilters[col];
        if (!activeValues) continue;
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

  // Flattened row model with section headers, used by the virtualizer. A
  // collapsed section keeps its header (with the full count) but drops its rows.
  const { reviewRows, prFlatIndexes } = useMemo(() => {
    const rows: ReviewRow[] = [];
    const flatIndexes: number[] = [];
    const sectionCounts = new Map<ReviewSection, number>();
    for (const pr of sortedPrs) {
      const section = reviewSectionOf(pr);
      sectionCounts.set(section, (sectionCounts.get(section) ?? 0) + 1);
    }
    let currentSection: ReviewSection | null = null;
    sortedPrs.forEach((pr, prIndex) => {
      const section = reviewSectionOf(pr);
      if (section !== currentSection) {
        currentSection = section;
        rows.push({
          kind: "header",
          key: section,
          label: REVIEW_SECTION_LABELS[section],
          count: sectionCounts.get(section) ?? 0,
        });
      }
      if (!collapsedSections.has(section)) {
        flatIndexes[prIndex] = rows.length;
        rows.push({ kind: "pr", pr, prIndex });
      }
    });
    return { reviewRows: rows, prFlatIndexes: flatIndexes };
  }, [sortedPrs, collapsedSections]);

  // Indexes into sortedPrs that are currently visible (in expanded sections),
  // in display order — the basis for keyboard navigation and selection clamping.
  const visibleSortedIndexes = useMemo(() => {
    const result: number[] = [];
    sortedPrs.forEach((pr, index) => {
      if (!collapsedSections.has(reviewSectionOf(pr))) result.push(index);
    });
    return result;
  }, [sortedPrs, collapsedSections]);

  const resultKeysSignature = useMemo(
    () =>
      sortedPrs
        .map((pr) => `${pr.organizationId}-${pr.repositoryId}-${pr.pullRequestId}`)
        .join("|"),
    [sortedPrs],
  );

  const visiblePrs = allPrs.filter((pr) => showDrafts || !pr.isDraft);
  const noVoteCount = visiblePrs.filter((pr) => pr.myVote === 0).length;
  const columnFilterCount = activeColumnFilterCount(columnFilters);
  const activeFilterCount = (textFilter.trim() ? 1 : 0) + columnFilterCount;
  const isFiltered = activeFilterCount > 0;
  const selectedPr = sortedPrs[selectedIndex] ?? null;

  // PRs in the active multi-selection, restored from keys so the set survives
  // re-sorts and background syncs. Falls back to the single focused row.
  const selectedPrs = useMemo(() => {
    if (selectedKeys.size === 0) return selectedPr ? [selectedPr] : [];
    return sortedPrs.filter((pr) => selectedKeys.has(reviewTriageKey(pr)));
  }, [selectedKeys, sortedPrs, selectedPr]);

  const isMultiSelect = selectedPrs.length >= 2;

  // Fetch changed files for each selected PR. Single selection still fetches so
  // the status bar can show that PR's file count; only multi-select runs the
  // overlap check. Results are cached per PR and shared with the review panel.
  const changeQueries = useQueries({
    queries: selectedPrs.map((pr) => ({
      queryKey: ["pullRequestChanges", pr.organizationId, pr.repositoryId, pr.pullRequestId],
      queryFn: () => listPullRequestChanges(prLocator(pr)),
      staleTime: 5 * 60_000,
    })),
  });

  const changesLoading = changeQueries.some((q) => q.isLoading);

  const overlap = useMemo(() => {
    if (!isMultiSelect) return { overlaps: [], fileCount: 0 };
    const prFileSets = selectedPrs.map((pr, i) => ({
      key: reviewTriageKey(pr),
      files: (changeQueries[i]?.data?.files ?? []).map((file) => file.path),
    }));
    return detectFileOverlaps(prFileSets);
    // changeQueries identity changes each render; key off the resolved data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMultiSelect, selectedPrs, changeQueries.map((q) => q.dataUpdatedAt).join("|")]);

  // Single-select file count for the status bar (no conflict check).
  const singleFileCount =
    !isMultiSelect && changeQueries[0]?.data ? changeQueries[0].data.files.length : null;

  const prKeyToLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const pr of selectedPrs) {
      map.set(reviewTriageKey(pr), `#${pr.pullRequestId}`);
    }
    return map;
  }, [selectedPrs]);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // A cross-link asked us to reveal a specific PR. Switch org if needed, drop
  // filters/collapsed sections that might hide it, and remember it as pending so
  // the resolution effect below can select it once it lands in the sorted rows.
  useEffect(() => {
    if (!selectRequest) return;
    pendingSelectRef.current = selectRequest;
    if (selectRequest.organizationId && selectRequest.organizationId !== organizationId) {
      setOrganizationId(selectRequest.organizationId);
    }
    setTextFilter("");
    setColumnFilters({});
    setShowDrafts(true);
    setShowDone(false);
    setShowSnoozed(false);
    setCollapsedSections(new Set());
    onSelectRequestHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectRequest?.requestId]);

  // Land a pending cross-link selection once its target PR is present in the
  // visible rows. Cleared when found, or left to retry as data loads.
  useEffect(() => {
    const pending = pendingSelectRef.current;
    if (!pending) return;
    const targetIndex = sortedPrs.findIndex(
      (pr) =>
        pr.pullRequestId === pending.pullRequestId &&
        (!pending.repositoryId || pr.repositoryId === pending.repositoryId),
    );
    if (targetIndex < 0) return;
    pendingSelectRef.current = null;
    setSelectedIndex(targetIndex);
    window.setTimeout(() => {
      scrollPrIntoView(targetIndex);
      focusRow(targetIndex);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedPrs]);

  useEffect(() => {
    if (!selectedPr) return;
    recordRecentPullRequest(selectedPr);
    // Opening a returned PR acknowledges it, clearing the highlight.
    const key = reviewTriageKey(selectedPr);
    if (returnedKeys.has(key)) {
      acknowledgeReturn(key);
      setReturnedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPr]);

  useEffect(() => {
    window.localStorage.setItem(
      REVIEW_PREVIEW_WIDTH_STORAGE_KEY,
      String(Math.round(previewWidth)),
    );
  }, [previewWidth]);

  // Keep the selection on a visible row: when data shrinks or the selected
  // row's section gets collapsed, snap to the nearest still-visible row.
  useEffect(() => {
    if (visibleSortedIndexes.length === 0) {
      setSelectedIndex(0);
      return;
    }
    if (!visibleSortedIndexes.includes(selectedIndex)) {
      const next =
        visibleSortedIndexes.find((index) => index >= selectedIndex) ??
        visibleSortedIndexes[visibleSortedIndexes.length - 1];
      setSelectedIndex(next);
    }
  }, [visibleSortedIndexes, selectedIndex]);

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

  function focusRow(index: number) {
    rowRefs.current[index]?.focus();
  }

  function scrollPrIntoView(prIndex: number) {
    const scroller = gridScrollRef.current;
    if (!scroller) return;
    const flatIndex = prFlatIndexes[prIndex];
    if (flatIndex == null) return;
    const rowTop = flatIndex * PR_GRID_ROW_HEIGHT;
    const rowBottom = rowTop + PR_GRID_ROW_HEIGHT;
    if (rowTop < scroller.scrollTop) {
      scroller.scrollTop = rowTop;
    } else if (rowBottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = rowBottom - scroller.clientHeight;
    }
  }

  // Select the visible row at the given position within visibleSortedIndexes.
  function selectVisiblePosition(position: number) {
    if (visibleSortedIndexes.length === 0) return;
    const clamped = Math.max(0, Math.min(position, visibleSortedIndexes.length - 1));
    const prIndex = visibleSortedIndexes[clamped];
    setSelectedIndex(prIndex);
    scrollPrIntoView(prIndex);
    window.setTimeout(() => focusRow(prIndex), 0);
  }

  function moveSelectionBy(delta: number) {
    const position = visibleSortedIndexes.indexOf(selectedIndex);
    selectVisiblePosition((position < 0 ? 0 : position) + delta);
  }

  // Replace the multi-selection with the inclusive range of visible rows
  // between the anchor PR and the given target index. Used by Shift+click and
  // Shift+Arrow to build the conflict-overlap set.
  function extendSelectionToIndex(targetIndex: number, explicitAnchorKey?: string) {
    const anchorKey =
      explicitAnchorKey ??
      selectionAnchor ??
      reviewTriageKey(sortedPrs[selectedIndex] ?? sortedPrs[targetIndex]);
    const anchorPosition = visibleSortedIndexes.findIndex(
      (index) => reviewTriageKey(sortedPrs[index]) === anchorKey,
    );
    const targetPosition = visibleSortedIndexes.indexOf(targetIndex);
    if (anchorPosition < 0 || targetPosition < 0) return;
    const [from, to] =
      anchorPosition <= targetPosition
        ? [anchorPosition, targetPosition]
        : [targetPosition, anchorPosition];
    const keys = new Set<string>();
    for (let position = from; position <= to; position += 1) {
      const pr = sortedPrs[visibleSortedIndexes[position]];
      if (pr) keys.add(reviewTriageKey(pr));
    }
    setSelectionAnchor(anchorKey);
    setSelectedKeys(keys);
  }

  function clearMultiSelection() {
    if (selectedKeys.size > 0) setSelectedKeys(new Set());
    setSelectionAnchor(null);
    setOverlapPopupOpen(false);
  }

  function toggleSection(section: ReviewSection) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  // Quick-vote the selected PR straight from the grid, without opening the panel.
  function voteSelected(vote: -10 | -5 | 0 | 5 | 10, label: string) {
    const pr = sortedPrs[selectedIndex];
    if (!pr || voteMutation.isPending) return;
    voteMutation.mutate(
      { ...prLocator(pr), vote },
      {
        onSuccess: () => {
          setCopyToast(`Voted: ${label}`);
          setTimeout(() => setCopyToast(null), 1500);
        },
      },
    );
  }

  function openFilter(col: FilterableColumn, anchorEl: HTMLButtonElement) {
    setFilterAnchorRect(anchorEl.getBoundingClientRect());
    setOpenFilterCol(col);
  }

  function toggleFilter(col: FilterableColumn, value: string) {
    const allValues = columnUniqueValues[col] ?? [];
    setColumnFilters((prev) => {
      const current = prev[col];
      // No active filter (absent key) means every value is checked, so the
      // first toggle deselects just the clicked value.
      if (!current) {
        const next = new Set(allValues.filter((candidate) => candidate !== value));
        return { ...prev, [col]: next };
      }

      const next = new Set(current);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
        if (next.size === allValues.length) {
          // Every value checked again collapses back to "(All)".
          const { [col]: _, ...rest } = prev;
          return rest;
        }
      }
      return { ...prev, [col]: next };
    });
    setSelectedIndex(0);
  }

  // Removes the column filter entirely, which means "show all" / (All).
  function clearColumnFilter(col: FilterableColumn) {
    setColumnFilters((prev) => {
      const { [col]: _, ...rest } = prev;
      return rest;
    });
    setSelectedIndex(0);
  }

  // Unchecks every value for the column, leaving an explicit empty selection so
  // the user can then pick exactly the values they want.
  function uncheckAllColumnFilter(col: FilterableColumn) {
    setColumnFilters((prev) => ({ ...prev, [col]: new Set<string>() }));
    setSelectedIndex(0);
  }

  function clearAllFilters() {
    setTextFilter("");
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
      } else if (e.key === "ArrowDown" && visibleSortedIndexes.length > 0) {
        e.preventDefault();
        const position = visibleSortedIndexes.indexOf(selectedIndex);
        selectVisiblePosition(position < 0 ? 0 : position);
      }
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
    if (e.key === "d" || e.key === "D") {
      e.preventDefault();
      setShowDrafts((value) => !value);
      setSelectedIndex(0);
      return;
    }
    if (e.key === "\\") {
      e.preventDefault();
      setMaximized((value) => !value);
      return;
    }
    if (e.key === "o" || e.key === "O") {
      e.preventDefault();
      const pr = sortedPrs[selectedIndex];
      if (pr?.webUrl) openExternalUrl(pr.webUrl);
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
    if (e.key === "z" || e.key === "Z") {
      e.preventDefault();
      const pr = sortedPrs[selectedIndex];
      if (pr) {
        snoozeTargetRef.current = pr;
        const rowEl = rowRefs.current[selectedIndex];
        setSnoozeAnchorRect(
          (rowEl ?? containerRef.current)?.getBoundingClientRect() ?? null,
        );
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
    if (e.key === "a" || e.key === "A") {
      e.preventDefault();
      voteSelected(10, "Approve");
      return;
    }
    if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      voteSelected(5, "Suggestions");
      return;
    }
    if (e.key === "w" || e.key === "W") {
      e.preventDefault();
      voteSelected(-5, "Wait");
      return;
    }
    if (e.key === "x" || e.key === "X") {
      e.preventDefault();
      voteSelected(-10, "Reject");
      return;
    }
    if (e.key === "0") {
      e.preventDefault();
      voteSelected(0, "No vote");
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
    if (visibleSortedIndexes.length === 0) return;
    // Shift+Arrow extends the multi-selection for the conflict-overlap check.
    if (e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const position = visibleSortedIndexes.indexOf(selectedIndex);
      const base = position < 0 ? 0 : position;
      const nextPosition = Math.max(
        0,
        Math.min(base + (e.key === "ArrowDown" ? 1 : -1), visibleSortedIndexes.length - 1),
      );
      const targetIndex = visibleSortedIndexes[nextPosition];
      const anchorKey =
        selectionAnchor ?? reviewTriageKey(sortedPrs[selectedIndex] ?? sortedPrs[targetIndex]);
      setSelectedIndex(targetIndex);
      scrollPrIntoView(targetIndex);
      window.setTimeout(() => focusRow(targetIndex), 0);
      extendSelectionToIndex(targetIndex, anchorKey);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
      e.preventDefault();
      clearMultiSelection();
      moveSelectionBy(1);
    } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
      e.preventDefault();
      clearMultiSelection();
      moveSelectionBy(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      clearMultiSelection();
      selectVisiblePosition(0);
    } else if (e.key === "End") {
      e.preventDefault();
      clearMultiSelection();
      selectVisiblePosition(visibleSortedIndexes.length - 1);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      clearMultiSelection();
      moveSelectionBy(10);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      clearMultiSelection();
      moveSelectionBy(-10);
    } else if (e.key === "Enter" || e.key === "ArrowRight") {
      // Enter / → step into the preview; ← / Esc step back (handled there).
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

  function toggleColumnVisibility(column: SortKey) {
    if (PR_GRID_REQUIRED_COLUMNS.includes(column)) return;
    setVisibleColumns((current) =>
      current.includes(column)
        ? current.filter((value) => value !== column)
        : PR_GRID_KEYS.filter((value) => value === column || current.includes(value)),
    );
  }

  function resetColumnVisibility() {
    setVisibleColumns([...PR_GRID_KEYS]);
  }

  const visibleColumnWidths = visibleColumns.map(
    (column) => columnWidths[PR_GRID_KEYS.indexOf(column)],
  );
  const titleFlexIndex = Math.max(0, visibleColumns.indexOf("title"));
  const COLS = gridColumnTemplate(visibleColumnWidths, titleFlexIndex);
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
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
        {organizations.length > 1 && (
          <select
            value={organizationId}
            onChange={(e) => { setOrganizationId(e.target.value); setSelectedIndex(0); clearMultiSelection(); }}
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

        {/* Draft checkbox */}
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showDrafts}
            onChange={(e) => {
              setShowDrafts(e.target.checked);
              setSelectedIndex(0);
            }}
            className="h-3.5 w-3.5 rounded border-input"
          />
          Show Drafts
        </label>

      </div>

      <div
        className={
          maximized
            ? "flex min-h-0 flex-1"
            : "grid min-h-0 flex-1 items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_8px_minmax(280px,var(--review-preview-width))]"
        }
        style={{ "--review-preview-width": `${previewWidth}px` } as CSSProperties}
      >
        {/* Grid */}
        <div
          className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card ${
            maximized ? "hidden" : ""
          }`}
        >
          {showSnoozed ? (
            <SnoozedItemsPanel
              organizationId={organizationId}
              itemType="pull_request"
              onUnsnoozed={() =>
                queryClient.invalidateQueries({ queryKey: ["myReviews"] })
              }
            />
          ) : (
          <div ref={gridScrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div className="min-w-[720px]">
              {/* Column headers */}
              <div
                role="row"
                className="grid items-center gap-2 border-b border-border bg-muted px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                style={{ gridTemplateColumns: COLS }}
              >
                {visibleColumns.map((col, i) => {
                  const fullIndex = PR_GRID_KEYS.indexOf(col);
                  const isLast = i === visibleColumns.length - 1;
                  return (
                    <SortHeaderButton
                      key={col}
                      column={col}
                      sort={sort}
                      onSort={applySort}
                      filterActive={isFilterableColumn(col) && columnFilters[col] !== undefined}
                      onFilterOpen={isFilterableColumn(col) ? (el) => openFilter(col, el) : undefined}
                      resizeHandle={
                        isLast ? undefined : (
                          <ColumnResizeHandle
                            columnIndex={fullIndex}
                            widths={columnWidths}
                            setWidths={setColumnWidths}
                            min={PR_GRID_COLUMN_MIN_WIDTHS[fullIndex]}
                            max={PR_GRID_COLUMN_MAX_WIDTHS[fullIndex]}
                            defaultWidth={DEFAULT_PR_GRID_COLUMN_WIDTHS[fullIndex]}
                          />
                        )
                      }
                    />
                  );
                })}
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
                      const collapsed = collapsedSections.has(row.key);
                      return (
                        <button
                          key={`header:${row.key}`}
                          type="button"
                          onClick={() => toggleSection(row.key)}
                          aria-expanded={!collapsed}
                          className="flex h-[29px] w-full items-center gap-1 border-b border-border bg-muted/60 px-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted focus:outline-none focus:ring-1 focus:ring-inset focus:ring-ring"
                        >
                          {collapsed ? (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          )}
                          {row.label}
                          <span className="font-normal normal-case">({row.count})</span>
                        </button>
                      );
                    }
                    return (
                      <ReviewPrRow
                        key={`${row.pr.organizationId}-${row.pr.repositoryId}-${row.pr.pullRequestId}`}
                        ref={(el) => { rowRefs.current[row.prIndex] = el; }}
                        columnTemplate={COLS}
                        pr={row.pr}
                        selected={row.prIndex === selectedIndex}
                        inMultiSelection={selectedKeys.has(reviewTriageKey(row.pr))}
                        returned={returnedKeys.has(reviewTriageKey(row.pr))}
                        visibleColumns={visibleColumns}
                        staleThresholdDays={staleThresholdDays}
                        onSelect={({ shiftKey }) => {
                          if (shiftKey) {
                            const anchorKey =
                              selectionAnchor ??
                              reviewTriageKey(sortedPrs[selectedIndex] ?? row.pr);
                            setSelectedIndex(row.prIndex);
                            extendSelectionToIndex(row.prIndex, anchorKey);
                          } else {
                            clearMultiSelection();
                            setSelectedIndex(row.prIndex);
                          }
                        }}
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
          )}

          {/* Status bar */}
          <div className="flex items-center justify-between border-t border-border px-2 py-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-3">
              <span>
                {visiblePrs.length} total,{" "}
                <span className="font-medium text-foreground">{noVoteCount}</span> not voted
                {returnedKeys.size > 0 ? (
                  <>
                    {", "}
                    <span className="font-medium text-purple-700 dark:text-purple-300">
                      {returnedKeys.size}
                    </span>{" "}
                    returned
                  </>
                ) : null}
              </span>
              {isMultiSelect ? (
                changesLoading ? (
                  <span>Checking {selectedPrs.length} PRs for overlapping files…</span>
                ) : overlap.fileCount > 0 ? (
                  <button
                    ref={overlapButtonRef}
                    type="button"
                    onClick={() => setOverlapPopupOpen((open) => !open)}
                    aria-expanded={overlapPopupOpen}
                    className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-100 px-2 py-0.5 font-medium text-amber-800 hover:bg-amber-200 focus:outline-none focus:ring-2 focus:ring-ring dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900"
                    title="These selected PRs change the same files — merging them may conflict"
                  >
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    Conflict risk: {overlap.fileCount} file{overlap.fileCount === 1 ? "" : "s"} overlap
                  </button>
                ) : (
                  <span className="text-foreground">
                    {selectedPrs.length} PRs selected, no overlapping files
                  </span>
                )
              ) : singleFileCount != null ? (
                <span>
                  {singleFileCount} changed file{singleFileCount === 1 ? "" : "s"}
                </span>
              ) : null}
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
                    : "border-border bg-card hover:bg-secondary"
                }`}
              >
                {showDone ? "Back to inbox" : `Done (${archivedKeys.size})`}
              </button>
              <button
                type="button"
                aria-pressed={showSnoozed}
                title="Toggle snoozed view (Z snoozes the selected row)"
                onClick={() => setShowSnoozed((value) => !value)}
                className={`rounded border px-2 py-0.5 text-xs ${
                  showSnoozed
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card hover:bg-secondary"
                }`}
              >
                {showSnoozed ? "Back to inbox" : "Snoozed"}
              </button>
              <ActiveFilters
                count={activeFilterCount}
                shownCount={sortedPrs.length}
                onClear={clearAllFilters}
              />
              <button
                type="button"
                onClick={(event) => setColumnMenuRect(event.currentTarget.getBoundingClientRect())}
                className="rounded border border-border bg-card px-2 py-0.5 text-xs hover:bg-secondary"
              >
                Columns
              </button>
            </span>
          </div>
        </div>

        <ResizeHandle
          ariaLabel="Resize review preview"
          className={maximized ? "hidden" : "hidden xl:flex"}
          direction={-1}
          max={MAX_REVIEW_PREVIEW_WIDTH}
          min={MIN_REVIEW_PREVIEW_WIDTH}
          onChange={setPreviewWidth}
          onReset={() => setPreviewWidth(DEFAULT_REVIEW_PREVIEW_WIDTH)}
          value={previewWidth}
        />

        <PrReviewPanel
          selectedPr={selectedPr}
          maximized={maximized}
          onToggleMaximize={() => setMaximized((value) => !value)}
        />
      </div>
      {openFilterCol && filterAnchorRect ? (
        <ColumnFilterDropdown
          anchorRect={filterAnchorRect}
          allValues={columnUniqueValues[openFilterCol] ?? []}
          activeValues={columnFilters[openFilterCol]}
          onToggle={(value) => toggleFilter(openFilterCol, value)}
          onClearAll={() => clearColumnFilter(openFilterCol)}
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
          columns={PR_GRID_KEYS.map((key) => ({ key, label: sortLabels[key] }))}
          visibleColumns={visibleColumns}
          requiredColumns={PR_GRID_REQUIRED_COLUMNS}
          onToggle={toggleColumnVisibility}
          onReset={resetColumnVisibility}
          onClose={() => setColumnMenuRect(null)}
        />
      ) : null}
      {snoozeAnchorRect ? (
        <SnoozeMenu
          anchorRect={snoozeAnchorRect}
          onSnooze={(snoozeUntil) => {
            const target = snoozeTargetRef.current;
            if (target) {
              snoozeMutation.mutate({
                organizationId,
                itemType: "pull_request",
                itemKey: `${target.repositoryId}:${target.pullRequestId}`,
                snoozeUntil,
              });
              setCopyToast("Snoozed");
              setTimeout(() => setCopyToast(null), 1500);
            }
            setSnoozeAnchorRect(null);
          }}
          onClose={() => setSnoozeAnchorRect(null)}
        />
      ) : null}
      {overlapPopupOpen && overlap.fileCount > 0 ? (
        <OverlapPopup
          anchorEl={overlapButtonRef.current}
          overlaps={overlap.overlaps}
          prKeyToLabel={prKeyToLabel}
          onClose={() => {
            setOverlapPopupOpen(false);
            overlapButtonRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

function OverlapPopup({
  anchorEl,
  overlaps,
  prKeyToLabel,
  onClose,
}: {
  anchorEl: HTMLButtonElement | null;
  overlaps: { path: string; prKeys: string[] }[];
  prKeyToLabel: Map<string, string>;
  onClose: () => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    popupRef.current?.focus();
  }, []);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (popupRef.current?.contains(e.target as Node)) return;
      if (anchorEl?.contains(e.target as Node)) return;
      onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [anchorEl, onClose]);

  const anchorRect = anchorEl?.getBoundingClientRect();
  const left = anchorRect ? Math.max(8, Math.min(anchorRect.left, window.innerWidth - 360)) : 8;
  const top = anchorRect ? Math.max(8, anchorRect.top - 8) : 8;

  return (
    <div
      ref={popupRef}
      role="dialog"
      aria-label="Overlapping changed files"
      tabIndex={-1}
      className="fixed z-50 w-[352px] -translate-y-full rounded-md border border-border bg-popover shadow-lg outline-none"
      style={{ left, top }}
      onKeyDown={(e) => {
        // Contain navigation keys so the underlying grid does not also react.
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs font-semibold text-foreground">
        <span>Overlapping files ({overlaps.length})</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="max-h-72 overflow-auto p-2 text-xs">
        {overlaps.map((overlap) => (
          <li key={overlap.path} className="border-b border-border/60 px-1 py-1.5 last:border-b-0">
            <div className="break-all font-mono text-foreground" title={overlap.path}>
              {overlap.path}
            </div>
            <div className="mt-0.5 text-muted-foreground">
              {overlap.prKeys.map((key) => prKeyToLabel.get(key) ?? key).join(", ")}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ColumnFilterDropdown({
  anchorRect,
  allValues,
  activeValues,
  onToggle,
  onClearAll,
  onUncheckAll,
  onClose,
}: {
  anchorRect: DOMRect;
  allValues: string[];
  activeValues: Set<string> | undefined;
  onToggle: (value: string) => void;
  onClearAll: () => void;
  onUncheckAll: () => void;
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

  const isAllChecked = activeValues === undefined;
  const anyChecked = isAllChecked || (activeValues?.size ?? 0) > 0;
  const filteredValues = search.trim()
    ? allValues.filter((value) => value.toLowerCase().includes(search.trim().toLowerCase()))
    : allValues;
  const top = Math.min(anchorRect.bottom + 2, window.innerHeight - 280);
  const left = Math.min(anchorRect.left, window.innerWidth - 208);

  return (
    <div
      ref={dropdownRef}
      className="fixed z-50 w-52 rounded-md border border-border bg-popover shadow-lg"
      style={{ top, left }}
    >
      <div className="border-b border-border p-1.5">
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="w-full rounded border border-input bg-background px-2 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="flex items-center gap-1 border-b border-border p-1">
        <button
          type="button"
          onClick={onClearAll}
          className={`flex-1 rounded px-2 py-0.5 text-left text-xs hover:bg-secondary ${
            isAllChecked ? "font-medium text-foreground" : "text-muted-foreground"
          }`}
        >
          (All)
        </button>
        <button
          type="button"
          onClick={onUncheckAll}
          disabled={!anyChecked}
          className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-secondary disabled:cursor-default disabled:opacity-40"
        >
          Uncheck all
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
