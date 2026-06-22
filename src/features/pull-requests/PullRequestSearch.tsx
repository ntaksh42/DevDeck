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
import { Filter, GitBranch, Loader2, Search } from 'lucide-react';
import {
  searchPullRequests,
  listCommitRepositories,
  listBranches,
  commandErrorMessage,
  type Organization,
  type SearchPullRequestsInput,
  type PullRequestSummary,
  type ReviewPullRequestSummary,
  type BranchSummary,
} from '@/lib/azdoCommands';
import {
  clamp,
  storedNumbers,
  storedNumber,
  gridColumnTemplate,
  isEditableTarget,
  focusFilterInput,
  focusPrimaryPreview,
  formatDate,
  formatRelativeDate,
} from '@/lib/utils';
import { openExternalUrl } from '@/lib/openExternal';
import { recordRecentPullRequest } from '@/lib/recentItems';
import { ColumnResizeHandle, ResizeHandle } from '@/components/ResizeHandle';
import { ColumnVisibilityMenu } from '@/components/ColumnVisibilityMenu';
import { ErrorState, LoadingState } from '@/components/StateDisplay';
import { ActiveFilters } from '@/components/ActiveFilters';
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

// The local cache only holds Active PRs (see prs.rs search()). Surfacing other
// statuses as choices would silently return zero rows and imply unsupported
// backend coverage, so the status selector intentionally offers Active only and
// the form explains the limitation.
const PR_SEARCH_STATUS: NonNullable<SearchPullRequestsInput["status"]> = "active";

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
  const [projectId, setProjectId] = useState("");
  const [repositoryId, setRepositoryId] = useState("");

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
    () => (projectId ? allRepositories.filter((r) => r.projectId === projectId) : allRepositories),
    [allRepositories, projectId],
  );

  function onProjectChange(newProjectId: string) {
    setProjectId(newProjectId);
    setRepositoryId("");
  }

  // The branches panel needs both project and repository; resolve the project
  // from the selected repository so it works even when "All projects" is shown.
  const selectedRepo = useMemo(
    () => allRepositories.find((r) => r.repositoryId === repositoryId),
    [allRepositories, repositoryId],
  );
  const [showBranches, setShowBranches] = useState(false);
  useEffect(() => {
    if (!repositoryId) setShowBranches(false);
  }, [repositoryId]);
  const branchesQuery = useQuery({
    queryKey: ["prBranches", organizationId, selectedRepo?.projectId, repositoryId],
    queryFn: () =>
      listBranches({
        organizationId,
        projectId: selectedRepo?.projectId ?? "",
        repositoryId,
      }),
    enabled: showBranches && !!organizationId && !!repositoryId && !!selectedRepo,
    staleTime: 60_000,
  });

  const mutation = useMutation({ mutationFn: searchPullRequests });
  const results = mutation.data ?? [];
  const activeSearchFilterCount = (query.trim() ? 1 : 0) + (projectId ? 1 : 0) + (repositoryId ? 1 : 0);

  useEffect(() => {
    window.localStorage.setItem(PR_SEARCH_QUERY_STORAGE_KEY, query);
  }, [query]);

  useEffect(() => {
    if (!externalSearch) return;
    const targetOrganizationId = externalSearch.organizationId ?? organizationId;
    setOrganizationId(targetOrganizationId);
    setQuery(externalSearch.query);
    setProjectId("");
    setRepositoryId("");
    mutation.mutate({
      organizationId: targetOrganizationId,
      query: externalSearch.query,
      status: PR_SEARCH_STATUS,
      projectId: undefined,
      repositoryId: undefined,
    });
    onExternalSearchHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSearch?.requestId]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate({
      organizationId,
      query,
      status: PR_SEARCH_STATUS,
      projectId: projectId || undefined,
      repositoryId: repositoryId || undefined,
    });
  }

  function clearSearchFilters() {
    setQuery("");
    setProjectId("");
    setRepositoryId("");
    if (mutation.isSuccess) {
      mutation.mutate({
        organizationId,
        query: "",
        status: PR_SEARCH_STATUS,
        projectId: undefined,
        repositoryId: undefined,
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
                onChange={(e) => { setOrganizationId(e.target.value); setProjectId(""); setRepositoryId(""); }}
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

            <label className="grid gap-2">
              <span className="text-sm font-medium">Status</span>
              <select
                value={PR_SEARCH_STATUS}
                disabled
                title="Only active pull requests are synced locally. Completed and abandoned PRs are not available yet."
                aria-describedby="pr-search-status-note"
                className="h-9 cursor-not-allowed rounded-md border border-input bg-background px-3 text-sm capitalize outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              >
                <option value={PR_SEARCH_STATUS}>Active</option>
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Project</span>
              <select
                value={projectId}
                onChange={(e) => onProjectChange(e.target.value)}
                disabled={repositoriesQuery.isLoading}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              >
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Repository</span>
              <select
                value={repositoryId}
                onChange={(e) => setRepositoryId(e.target.value)}
                disabled={repositoriesQuery.isLoading}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              >
                <option value="">All repositories</option>
                {filteredRepositories.map((r) => (
                  <option key={r.repositoryId} value={r.repositoryId}>{r.repositoryName}</option>
                ))}
              </select>
            </label>

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
          <div className="flex items-center justify-between gap-2">
            <p id="pr-search-status-note" className="text-xs text-muted-foreground">
              Only active pull requests are synced locally. Completed and abandoned
              pull requests are not available here yet.
            </p>
            <button
              type="button"
              onClick={() => setShowBranches((open) => !open)}
              disabled={!repositoryId}
              aria-expanded={showBranches}
              title={repositoryId ? "Show branches for the selected repository" : "Select a repository to list its branches"}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GitBranch className="h-4 w-4" aria-hidden="true" />
              {showBranches ? "Hide branches" : "Branches"}
            </button>
          </div>
        </form>
      </div>

      {showBranches && repositoryId ? (
        <BranchesPanel
          loading={branchesQuery.isLoading}
          error={branchesQuery.isError ? commandErrorMessage(branchesQuery.error) : null}
          branches={branchesQuery.data ?? []}
          onOpenPullRequest={(url) => void openExternalUrl(url)}
        />
      ) : null}

      {mutation.isError && <ErrorState message={commandErrorMessage(mutation.error)} />}

      <PullRequestResults
        activeExternalFilterCount={activeSearchFilterCount}
        loading={mutation.isPending}
        onClearExternalFilters={clearSearchFilters}
        results={results}
        searched={mutation.isSuccess}
      />
    </div>
  );
}

function BranchesPanel({
  loading,
  error,
  branches,
  onOpenPullRequest,
}: {
  loading: boolean;
  error: string | null;
  branches: BranchSummary[];
  onOpenPullRequest: (url: string) => void;
}) {
  return (
    <div className="shrink-0 rounded-md border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium">
        <GitBranch className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Branches
        {!loading && !error ? (
          <span className="text-xs font-normal text-muted-foreground">{branches.length}</span>
        ) : null}
      </div>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : branches.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">No branches found.</p>
      ) : (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">Branch</th>
                <th className="px-3 py-1.5 font-medium">Ahead / Behind</th>
                <th className="px-3 py-1.5 font-medium">Last update</th>
                <th className="px-3 py-1.5 font-medium">Pull request</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => {
                const pr =
                  b.pullRequestId && b.pullRequestUrl
                    ? { id: b.pullRequestId, url: b.pullRequestUrl, title: b.pullRequestTitle }
                    : null;
                return (
                  <tr key={b.name} className="border-t border-border/60">
                    <td className="px-3 py-1.5">
                      <span className="font-medium">{b.name}</span>
                      {b.isBaseVersion ? (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                          default
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                      <span className="text-emerald-600 dark:text-emerald-400">↑{b.aheadCount}</span>{" "}
                      <span className="text-amber-600 dark:text-amber-400">↓{b.behindCount}</span>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {b.lastUpdated ? formatRelativeDate(b.lastUpdated) : "—"}
                      {b.lastAuthor ? ` · ${b.lastAuthor}` : ""}
                    </td>
                    <td className="px-3 py-1.5">
                      {pr ? (
                        <button
                          type="button"
                          onClick={() => onOpenPullRequest(pr.url)}
                          className="text-primary hover:underline"
                          title={pr.title ?? undefined}
                        >
                          #{pr.id}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function activeColumnFilterCount(
  filters: Partial<Record<PrSearchFilterableColumn, Set<string>>>,
): number {
  // An absent key means "(All)"; an empty set means "uncheck all" (an explicit
  // selection of nothing), so both are counted as an active column filter.
  return (Object.values(filters) as (Set<string> | undefined)[]).filter(
    (values) => values !== undefined,
  ).length;
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
}: {
  activeExternalFilterCount?: number;
  loading: boolean;
  onClearExternalFilters?: () => void;
  results: PullRequestSummary[];
  searched: boolean;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [columnWidths, setColumnWidths] = useState(() =>
    storedNumbers(
      PR_SEARCH_COLUMN_WIDTHS_STORAGE_KEY,
      DEFAULT_PR_SEARCH_COLUMN_WIDTHS,
      PR_SEARCH_COLUMN_MIN_WIDTHS,
      PR_SEARCH_COLUMN_MAX_WIDTHS,
    ),
  );
  const [columnFilters, setColumnFilters] = useState<Partial<Record<PrSearchFilterableColumn, Set<string>>>>({});
  const [openFilterCol, setOpenFilterCol] = useState<PrSearchFilterableColumn | null>(null);
  const [filterAnchorRect, setFilterAnchorRect] = useState<DOMRect | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<PrSearchColumnKey[]>(
    loadPrSearchVisibleColumns,
  );
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
    localStorage.setItem(PR_SEARCH_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

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

  const visibleColumnWidths = visibleColumns.map(
    (column) => columnWidths[PR_SEARCH_KEYS.indexOf(column)],
  );
  const titleFlexIndex = Math.max(0, visibleColumns.indexOf("title"));
  const columnTemplate = gridColumnTemplate(visibleColumnWidths, titleFlexIndex);

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
    if (hasActiveColumnFilters) {
      return `${filteredResults.length} of ${results.length} pull request${results.length === 1 ? "" : "s"}`;
    }
    return `${results.length} pull request${results.length === 1 ? "" : "s"}`;
  }, [filteredResults.length, hasActiveColumnFilters, loading, results.length, searched]);

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
          <div ref={setScrollerEl} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="min-w-[680px]">
          <div
            role="row"
            className="grid border-b border-border bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground"
            style={{ gridTemplateColumns: columnTemplate }}
          >
            {visibleColumns.map((key, i) => {
              const fullIndex = PR_SEARCH_KEYS.indexOf(key);
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
                    <ColumnResizeHandle
                      columnIndex={fullIndex}
                      widths={columnWidths}
                      setWidths={setColumnWidths}
                      min={PR_SEARCH_COLUMN_MIN_WIDTHS[fullIndex]}
                      max={PR_SEARCH_COLUMN_MAX_WIDTHS[fullIndex]}
                      defaultWidth={DEFAULT_PR_SEARCH_COLUMN_WIDTHS[fullIndex]}
                    />
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
