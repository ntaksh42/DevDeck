import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  Fragment,
  forwardRef,
  useEffect,
  useRef,
  useMemo,
  useState,
} from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Filter, Loader2, Search } from 'lucide-react';
import {
  searchPullRequests,
  listCommitRepositories,
  commandErrorMessage,
  type Organization,
  type SearchPullRequestsInput,
  type PullRequestSummary,
  type ReviewPullRequestSummary,
} from '@/lib/azdoCommands';
import {
  clamp,
  storedNumber,
  isEditableTarget,
  focusFilterInput,
  focusPrimaryPreview,
  formatDate,
  formatRelativeDate,
} from '@/lib/utils';
import { useGridColumns } from '@/lib/useGridColumns';
import { openExternalUrl } from '@/lib/openExternal';
import { recordRecentPullRequest } from '@/lib/recentItems';
import { ColumnResizeHandle, ResizeHandle } from '@/components/ResizeHandle';
import { ColumnVisibilityMenu } from '@/components/ColumnVisibilityMenu';
import { ErrorState, LoadingState } from '@/components/StateDisplay';
import { ActiveFilters } from '@/components/ActiveFilters';
import { ColumnFilterDropdown } from '@/components/ColumnFilterDropdown';
import { activeColumnFilterCount } from '@/lib/columnFilters';
import { MultiSelectFilter } from '@/components/MultiSelectFilter';
import { PrReviewPanel } from './PrReviewPanel';

const DEFAULT_PR_SEARCH_PREVIEW_WIDTH = 460;
const MIN_PR_SEARCH_PREVIEW_WIDTH = 320;
const MAX_PR_SEARCH_PREVIEW_WIDTH = 8192;
const PR_SEARCH_PREVIEW_WIDTH_STORAGE_KEY = 'azdodeck:layout:prSearchPreviewWidth';

// Adapts a search result to the shape PrReviewPanel needs; the panel refetches
// the real review (vote/reviewers/threads) by locator, so these are defaults.
function toReviewSummary(pr: PullRequestSummary): ReviewPullRequestSummary {
  return {
    ...pr,
    myVote: 0,
    myVoteLabel: "No Vote",
    myIsRequired: false,
    isDraft: false,
    mergeStatus: null,
    ciStatus: null,
    ciContext: null,
    ciCheckCount: 0,
  };
}

const DEFAULT_PR_SEARCH_COLUMN_WIDTHS = [56, 70, 220, 130, 104, 64, 120];
const PR_SEARCH_COLUMN_MIN_WIDTHS = [52, 64, 160, 104, 86, 58, 100];
const PR_SEARCH_COLUMN_MAX_WIDTHS = [120, 140, 720, 360, 280, 120, 360];
const PR_SEARCH_COLUMN_WIDTHS_STORAGE_KEY = 'azdodeck:layout:prSearchGridColumnWidths:v2';
const PR_SEARCH_QUERY_STORAGE_KEY = 'azdodeck:view:prSearchQuery';
const PR_SEARCH_ROW_HEIGHT = 29;
const PR_SEARCH_OVERSCAN = 8;
type PrSearchFilterableColumn = "status" | "repository" | "createdBy" | "branch";

type PrSearchStatus = NonNullable<SearchPullRequestsInput["statuses"]>[number];

// Active PRs come from the local cache; the other statuses are fetched live from
// Azure DevOps by prs.rs search() because completed/abandoned history is too
// large to sync. The note under the form explains the difference.
const PR_SEARCH_STATUS_OPTIONS: { value: PrSearchStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "abandoned", label: "Abandoned" },
];
const PR_SEARCH_STATUS_STORAGE_KEY = "azdodeck:view:prSearchStatuses";

function loadPrSearchStatuses(): PrSearchStatus[] {
  const valid = new Set(PR_SEARCH_STATUS_OPTIONS.map((option) => option.value));
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(PR_SEARCH_STATUS_STORAGE_KEY) ?? "null",
    );
    if (Array.isArray(parsed)) {
      const kept = parsed.filter((value): value is PrSearchStatus => valid.has(value));
      if (kept.length > 0) return kept;
    }
  } catch {
    // Ignore malformed storage and fall back to the default below.
  }
  return ["active"];
}

type PrSearchDateBasis = NonNullable<SearchPullRequestsInput["dateBasis"]>;
const PR_SEARCH_DATE_BASIS_OPTIONS: { value: PrSearchDateBasis; label: string }[] = [
  { value: "created", label: "Created date" },
  { value: "closed", label: "Closed date" },
];
const PR_SEARCH_DATE_BASIS_STORAGE_KEY = "azdodeck:view:prSearchDateBasis";

function loadPrSearchDateBasis(): PrSearchDateBasis {
  const stored = window.localStorage.getItem(PR_SEARCH_DATE_BASIS_STORAGE_KEY);
  return PR_SEARCH_DATE_BASIS_OPTIONS.some((option) => option.value === stored)
    ? (stored as PrSearchDateBasis)
    : "created";
}

type PrSearchSortBy = NonNullable<SearchPullRequestsInput["sortBy"]>;
const PR_SEARCH_SORT_OPTIONS: { value: PrSearchSortBy; label: string }[] = [
  { value: "created", label: "Newest created" },
  { value: "closed", label: "Recently closed" },
  { value: "title", label: "Title (A–Z)" },
];
const PR_SEARCH_SORT_STORAGE_KEY = "azdodeck:view:prSearchSort";

function loadPrSearchSortBy(): PrSearchSortBy {
  const stored = window.localStorage.getItem(PR_SEARCH_SORT_STORAGE_KEY);
  return PR_SEARCH_SORT_OPTIONS.some((option) => option.value === stored)
    ? (stored as PrSearchSortBy)
    : "created";
}

const PR_SEARCH_FILTERABLE_COLUMNS: Record<PrSearchFilterableColumn, (pr: PullRequestSummary) => string> = {
  status: (pr) => pr.status,
  repository: (pr) => `${pr.projectName} / ${pr.repositoryName}`,
  createdBy: (pr) => pr.createdBy ?? "Unknown",
  branch: (pr) => `${pr.sourceRefName} -> ${pr.targetRefName}`,
};

export function PullRequestSearch({
  organizations,
  externalSearch,
  onExternalSearchHandled,
}: {
  organizations: Organization[];
  externalSearch?: { query: string; requestId: number; organizationId?: string } | null;
  onExternalSearchHandled?: () => void;
}) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  // Keep the last query across view switches (the component remounts on nav).
  const [query, setQuery] = useState(
    () => window.localStorage.getItem(PR_SEARCH_QUERY_STORAGE_KEY) ?? "",
  );
  const [statuses, setStatuses] = useState<PrSearchStatus[]>(loadPrSearchStatuses);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [repositoryIds, setRepositoryIds] = useState<string[]>([]);
  const [targetBranch, setTargetBranch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [dateBasis, setDateBasis] = useState<PrSearchDateBasis>(loadPrSearchDateBasis);
  const [sortBy, setSortBy] = useState<PrSearchSortBy>(loadPrSearchSortBy);
  const [excludeDrafts, setExcludeDrafts] = useState(false);

  const repositoriesQuery = useQuery({
    queryKey: ["prRepositories", organizationId],
    queryFn: () => listCommitRepositories({ organizationId }),
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
  });
  const allRepositories = repositoriesQuery.data ?? [];

  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const repo of allRepositories) seen.set(repo.projectId, repo.projectName);
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [allRepositories]);

  const filteredRepositories = useMemo(
    () =>
      projectIds.length > 0
        ? allRepositories.filter((r) => projectIds.includes(r.projectId))
        : allRepositories,
    [allRepositories, projectIds],
  );

  // Changing the project scope drops repository selections that no longer
  // belong to any selected project, so the two filters stay consistent.
  function onProjectsChange(nextProjectIds: string[]) {
    setProjectIds(nextProjectIds);
    if (nextProjectIds.length > 0) {
      const allowed = new Set(
        allRepositories
          .filter((r) => nextProjectIds.includes(r.projectId))
          .map((r) => r.repositoryId),
      );
      setRepositoryIds((prev) => prev.filter((id) => allowed.has(id)));
    }
  }

  const mutation = useMutation({ mutationFn: searchPullRequests });
  const results = mutation.data?.pullRequests ?? [];
  const truncated = mutation.data?.truncated ?? false;
  const total = mutation.data?.total ?? 0;
  const activeSearchFilterCount =
    (query.trim() ? 1 : 0) +
    (projectIds.length > 0 ? 1 : 0) +
    (repositoryIds.length > 0 ? 1 : 0) +
    (targetBranch.trim() ? 1 : 0) +
    (fromDate ? 1 : 0) +
    (toDate ? 1 : 0) +
    (excludeDrafts ? 1 : 0);

  // Bundles the advanced filter state shared by every search trigger.
  function advancedFilters(): Partial<SearchPullRequestsInput> {
    return {
      targetBranch: targetBranch.trim() || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      dateBasis,
      excludeDrafts: excludeDrafts || undefined,
      sortBy,
    };
  }

  useEffect(() => {
    window.localStorage.setItem(PR_SEARCH_QUERY_STORAGE_KEY, query);
  }, [query]);

  useEffect(() => {
    window.localStorage.setItem(PR_SEARCH_STATUS_STORAGE_KEY, JSON.stringify(statuses));
  }, [statuses]);

  useEffect(() => {
    window.localStorage.setItem(PR_SEARCH_DATE_BASIS_STORAGE_KEY, dateBasis);
  }, [dateBasis]);

  useEffect(() => {
    window.localStorage.setItem(PR_SEARCH_SORT_STORAGE_KEY, sortBy);
  }, [sortBy]);

  useEffect(() => {
    if (!externalSearch) return;
    const targetOrganizationId = externalSearch.organizationId ?? organizationId;
    setOrganizationId(targetOrganizationId);
    setQuery(externalSearch.query);
    // The palette looks up active PRs, so reset the status and scope filters.
    setStatuses(["active"]);
    setProjectIds([]);
    setRepositoryIds([]);
    setTargetBranch("");
    setFromDate("");
    setToDate("");
    setExcludeDrafts(false);
    mutation.mutate({
      organizationId: targetOrganizationId,
      query: externalSearch.query,
      statuses: ["active"],
      projectIds: undefined,
      repositoryIds: undefined,
    });
    onExternalSearchHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSearch?.requestId]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate({
      organizationId,
      query,
      statuses: statuses.length > 0 ? statuses : undefined,
      projectIds: projectIds.length > 0 ? projectIds : undefined,
      repositoryIds: repositoryIds.length > 0 ? repositoryIds : undefined,
      ...advancedFilters(),
    });
  }

  function clearSearchFilters() {
    setQuery("");
    setProjectIds([]);
    setRepositoryIds([]);
    setTargetBranch("");
    setFromDate("");
    setToDate("");
    setExcludeDrafts(false);
    if (mutation.isSuccess) {
      mutation.mutate({
        organizationId,
        query: "",
        statuses: statuses.length > 0 ? statuses : undefined,
        projectIds: undefined,
        repositoryIds: undefined,
        dateBasis,
        sortBy,
      });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0 rounded-md border border-border bg-card">
        <form className="grid gap-3 p-3" onSubmit={onSubmit}>
          {organizations.length > 1 && (
            <label className="grid gap-2">
              <span className="text-sm font-medium">Organization</span>
              <select
                value={organizationId}
                onChange={(e) => { setOrganizationId(e.target.value); setProjectIds([]); setRepositoryIds([]); }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
          )}
          <div className="grid gap-3 lg:grid-cols-[1fr_140px_160px_200px_auto]">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Search</span>
              <div className="flex h-9 items-center rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
                <Search className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="title, author, branch…"
                  autoFocus
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </div>
            </label>

            <div className="grid gap-2">
              <span className="text-sm font-medium" id="pr-search-status-label">Status</span>
              <MultiSelectFilter
                options={PR_SEARCH_STATUS_OPTIONS}
                selected={statuses}
                onChange={(next) => setStatuses(next as PrSearchStatus[])}
                placeholder="Active"
                ariaLabel="Filter by status"
                capitalize
              />
            </div>

            <div className="grid gap-2">
              <span className="text-sm font-medium">Project</span>
              <MultiSelectFilter
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
                selected={projectIds}
                onChange={onProjectsChange}
                placeholder="All projects"
                ariaLabel="Filter by project"
                searchable
                disabled={repositoriesQuery.isLoading}
              />
            </div>

            <div className="grid gap-2">
              <span className="text-sm font-medium">Repository</span>
              <MultiSelectFilter
                options={filteredRepositories.map((r) => ({
                  value: r.repositoryId,
                  label: r.repositoryName,
                }))}
                selected={repositoryIds}
                onChange={setRepositoryIds}
                placeholder="All repositories"
                ariaLabel="Filter by repository"
                searchable
                disabled={repositoriesQuery.isLoading}
              />
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={mutation.isPending || !organizationId}
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
              >
                {mutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Search className="h-4 w-4" aria-hidden="true" />
                )}
                Search
              </button>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_150px_150px_150px_170px_auto]">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Target branch</span>
              <input
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                placeholder="e.g. main"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">From</span>
              <input
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">To</span>
              <input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => setToDate(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Date basis</span>
              <select
                value={dateBasis}
                onChange={(e) => setDateBasis(e.target.value as PrSearchDateBasis)}
                title={statuses.length === 0 || statuses.includes("active")
                  ? "Active PRs have no close date, so the window uses the created date for them."
                  : "Whether the date window filters by created or closed date."}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {PR_SEARCH_DATE_BASIS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Sort by</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as PrSearchSortBy)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {PR_SEARCH_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="flex items-end gap-2 pb-2 lg:pb-0 lg:items-center">
              <input
                type="checkbox"
                checked={excludeDrafts}
                onChange={(e) => setExcludeDrafts(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-sm font-medium">Hide drafts</span>
            </label>
          </div>

          <p id="pr-search-status-note" className="text-xs text-muted-foreground">
            Active pull requests are served from the local cache. Completed and
            abandoned pull requests are fetched live from Azure DevOps, so those
            statuses may take a moment. Target branch and the date window narrow
            the live query server-side.
          </p>
        </form>
      </div>

      {mutation.isError && <ErrorState message={commandErrorMessage(mutation.error)} />}

      <PullRequestResults
        activeExternalFilterCount={activeSearchFilterCount}
        loading={mutation.isPending}
        onClearExternalFilters={clearSearchFilters}
        results={results}
        searched={mutation.isSuccess}
        truncated={truncated}
        total={total}
      />
    </div>
  );
}

type PrSearchColumnKey =
  | "pullRequestId"
  | "status"
  | "title"
  | "repository"
  | "author"
  | "date"
  | "branch";
const PR_SEARCH_KEYS: PrSearchColumnKey[] = [
  "pullRequestId",
  "status",
  "title",
  "repository",
  "author",
  "date",
  "branch",
];
const PR_SEARCH_COLUMN_LABELS: Record<PrSearchColumnKey, string> = {
  pullRequestId: "PR#",
  status: "Status",
  title: "Title",
  repository: "Repository",
  author: "Author",
  date: "Date",
  branch: "Branch",
};
const PR_SEARCH_REQUIRED_COLUMNS: PrSearchColumnKey[] = ["pullRequestId", "title"];
const PR_SEARCH_COLUMN_FILTER_KEY: Partial<Record<PrSearchColumnKey, PrSearchFilterableColumn>> = {
  status: "status",
  repository: "repository",
  author: "createdBy",
  branch: "branch",
};
const PR_SEARCH_VISIBLE_COLUMNS_STORAGE_KEY = "azdodeck:layout:prSearchVisibleColumns:v1";

function loadPrSearchVisibleColumns(): PrSearchColumnKey[] {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(PR_SEARCH_VISIBLE_COLUMNS_STORAGE_KEY) ?? "null",
    );
    if (!Array.isArray(parsed)) return [...PR_SEARCH_KEYS];
    const set = new Set(
      parsed.filter((v): v is PrSearchColumnKey => PR_SEARCH_KEYS.includes(v as PrSearchColumnKey)),
    );
    for (const required of PR_SEARCH_REQUIRED_COLUMNS) set.add(required);
    const ordered = PR_SEARCH_KEYS.filter((key) => set.has(key));
    return ordered.length > 0 ? ordered : [...PR_SEARCH_KEYS];
  } catch {
    return [...PR_SEARCH_KEYS];
  }
}

// Cells stay direct grid items (keyed Fragment) so the column template lines up.
function renderPrSearchCell(key: PrSearchColumnKey, pr: PullRequestSummary): ReactNode {
  switch (key) {
    case "pullRequestId":
      return (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (pr.webUrl) openExternalUrl(pr.webUrl); }}
          className="truncate text-left font-mono text-xs text-primary hover:underline"
          title={`PR #${pr.pullRequestId}`}
        >
          #{pr.pullRequestId}
        </button>
      );
    case "status": {
      const statusColor = PR_STATUS_COLORS[pr.status] ?? "bg-secondary text-foreground border-border";
      return (
        <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium capitalize ${statusColor}`}>
          {pr.status}
        </span>
      );
    }
    case "title":
      return (
        <span className="truncate font-medium text-foreground" title={pr.title}>
          {pr.title}
        </span>
      );
    case "repository":
      return (
        <span className="truncate text-xs text-muted-foreground" title={`${pr.projectName} / ${pr.repositoryName}`}>
          {pr.projectName} / {pr.repositoryName}
        </span>
      );
    case "author":
      return (
        <span className="truncate text-sm text-muted-foreground" title={pr.createdBy ?? "Unknown"}>
          {pr.createdBy ?? "Unknown"}
        </span>
      );
    case "date":
      return (
        <span className="text-xs text-muted-foreground" title={formatDate(pr.creationDate)}>
          {formatRelativeDate(pr.creationDate)}
        </span>
      );
    case "branch":
      return (
        <span className="truncate text-xs text-muted-foreground" title={`${pr.sourceRefName} → ${pr.targetRefName}`}>
          {pr.sourceRefName} → {pr.targetRefName}
        </span>
      );
  }
}

function PullRequestResults({
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
  const [visibleColumns, setVisibleColumns] = useState<PrSearchColumnKey[]>(
    loadPrSearchVisibleColumns,
  );
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
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);
  const [gridViewport, setGridViewport] = useState({ height: 0, scrollTop: 0 });

  useEffect(() => {
    localStorage.setItem(PR_SEARCH_PREVIEW_WIDTH_STORAGE_KEY, String(Math.round(previewWidth)));
  }, [previewWidth]);

  useEffect(() => {
    localStorage.setItem(PR_SEARCH_VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify(visibleColumns));
  }, [visibleColumns]);

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

  function toggleColumnVisibility(column: PrSearchColumnKey) {
    if (PR_SEARCH_REQUIRED_COLUMNS.includes(column)) return;
    setVisibleColumns((current) =>
      current.includes(column)
        ? current.filter((value) => value !== column)
        : PR_SEARCH_KEYS.filter((value) => value === column || current.includes(value)),
    );
  }

  function resetColumnVisibility() {
    setVisibleColumns([...PR_SEARCH_KEYS]);
  }


  const columnUniqueValues = useMemo(() => {
    const map = {} as Record<PrSearchFilterableColumn, string[]>;
    for (const col of Object.keys(PR_SEARCH_FILTERABLE_COLUMNS) as PrSearchFilterableColumn[]) {
      map[col] = [...new Set(results.map(PR_SEARCH_FILTERABLE_COLUMNS[col]))].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );
    }
    return map;
  }, [results]);

  const filteredResults = useMemo(() => {
    const hasFilters = (Object.values(columnFilters) as (Set<string> | undefined)[]).some(
      (values) => values !== undefined,
    );
    if (!hasFilters) return results;
    return results.filter((pr) => {
      for (const col of Object.keys(columnFilters) as PrSearchFilterableColumn[]) {
        const activeValues = columnFilters[col];
        if (!activeValues) continue;
        if (!activeValues.has(PR_SEARCH_FILTERABLE_COLUMNS[col](pr))) return false;
      }
      return true;
    });
  }, [columnFilters, results]);

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

  function scrollRowIntoView(index: number) {
    if (!scrollerEl) return;
    const rowTop = index * PR_SEARCH_ROW_HEIGHT;
    const rowBottom = rowTop + PR_SEARCH_ROW_HEIGHT;
    if (rowTop < scrollerEl.scrollTop) {
      scrollerEl.scrollTop = rowTop;
    } else if (rowBottom > scrollerEl.scrollTop + scrollerEl.clientHeight) {
      scrollerEl.scrollTop = rowBottom - scrollerEl.clientHeight;
    }
  }

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
  }

  const firstVirtualRow = Math.max(
    0,
    Math.floor(gridViewport.scrollTop / PR_SEARCH_ROW_HEIGHT) - PR_SEARCH_OVERSCAN,
  );
  const visibleRowCount = Math.ceil(
    Math.max(gridViewport.height, PR_SEARCH_ROW_HEIGHT) / PR_SEARCH_ROW_HEIGHT,
  );
  const lastVirtualRow = Math.min(
    filteredResults.length,
    firstVirtualRow + visibleRowCount + PR_SEARCH_OVERSCAN * 2,
  );
  const virtualRows = filteredResults.slice(firstVirtualRow, lastVirtualRow);
  const virtualTopPadding = firstVirtualRow * PR_SEARCH_ROW_HEIGHT;
  const virtualBottomPadding =
    Math.max(0, filteredResults.length - lastVirtualRow) * PR_SEARCH_ROW_HEIGHT;

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
          <div ref={setScrollerEl} className="min-h-0 flex-1 overflow-y-auto overflow-x-auto">
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
          onToggle={toggleColumnVisibility}
          onReset={resetColumnVisibility}
          onClose={() => setColumnMenuRect(null)}
        />
      ) : null}
    </div>
  );
}

const PR_STATUS_COLORS: Record<string, string> = {
  active: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900",
  completed: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900",
  abandoned: "bg-gray-50 text-gray-500 border-gray-200 dark:bg-muted dark:text-muted-foreground dark:border-border",
};

const PrSearchRow = forwardRef<
  HTMLDivElement,
  {
    pr: PullRequestSummary;
    selected: boolean;
    columnTemplate: string;
    visibleColumns: PrSearchColumnKey[];
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
          if (e.ctrlKey && pr.webUrl) openExternalUrl(pr.webUrl);
          else focusPrimaryPreview();
        }
      }}
      className={`grid h-[29px] cursor-pointer select-none items-center gap-2 border-b border-border px-2 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
        selected ? "bg-secondary" : "hover:bg-muted/50"
      }`}
      style={{ gridTemplateColumns: columnTemplate }}
    >
      {visibleColumns.map((key) => (
        <Fragment key={key}>{renderPrSearchCell(key, pr)}</Fragment>
      ))}
    </div>
  );
});
PrSearchRow.displayName = "PrSearchRow";
