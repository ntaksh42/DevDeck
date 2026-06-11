import {
  type FormEvent,
  type ReactNode,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Info, Loader2, Search } from "lucide-react";
import {
  searchCommits,
  listCommitRepositories,
  commandErrorMessage,
  type CommitSummary,
  type CommitRepositoryOption,
  type Organization,
} from "@/lib/azdoCommands";
import {
  clamp,
  storedNumbers,
  gridColumnTemplate,
  isEditableTarget,
  formatDate,
  formatRelativeDate,
} from "@/lib/utils";
import { openExternalUrl } from "@/lib/openExternal";
import { ShortcutHint } from "@/components/ShortcutHint";
import { ColumnResizeHandle } from "@/components/ResizeHandle";
import { ErrorState } from "@/components/StateDisplay";

const DEFAULT_COMMIT_COLUMN_WIDTHS = [72, 80, 220, 140, 120];
const COMMIT_COLUMN_MIN_WIDTHS = [66, 72, 160, 110, 96];
const COMMIT_COLUMN_MAX_WIDTHS = [140, 160, 720, 380, 340];
const COMMIT_COLUMN_WIDTHS_STORAGE_KEY = "azdodeck:layout:commitGridColumnWidths:v2";
const COMMIT_SEARCH_VIEW_STORAGE_KEY = "azdodeck:view:commitSearch:v1";
const COMMIT_SORT_STORAGE_KEY = "azdodeck:view:commitGridSort:v1";
const COMMIT_GRID_ROW_HEIGHT = 29;
const COMMIT_GRID_OVERSCAN = 8;

type CommitSearchViewState = {
  author: string;
  branch: string;
  fromDate: string;
  organizationId: string;
  projectId: string;
  query: string;
  repositoryId: string;
  toDate: string;
};

function loadCommitSearchViewState(): CommitSearchViewState {
  const fallback: CommitSearchViewState = {
    author: "",
    branch: "",
    fromDate: "",
    organizationId: "",
    projectId: "",
    query: "",
    repositoryId: "",
    toDate: "",
  };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMMIT_SEARCH_VIEW_STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    return {
      author: typeof parsed.author === "string" ? parsed.author : "",
      branch: typeof parsed.branch === "string" ? parsed.branch : "",
      fromDate: typeof parsed.fromDate === "string" ? parsed.fromDate : "",
      organizationId: typeof parsed.organizationId === "string" ? parsed.organizationId : "",
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : "",
      query: typeof parsed.query === "string" ? parsed.query : "",
      repositoryId: typeof parsed.repositoryId === "string" ? parsed.repositoryId : "",
      toDate: typeof parsed.toDate === "string" ? parsed.toDate : "",
    };
  } catch {
    return fallback;
  }
}

function storeCommitSearchViewState(state: CommitSearchViewState) {
  window.localStorage.setItem(COMMIT_SEARCH_VIEW_STORAGE_KEY, JSON.stringify(state));
}

export function CommitSearch({
  organizations,
  externalSearch,
  onExternalSearchHandled,
}: {
  organizations: Organization[];
  externalSearch?: { query: string; requestId: number; organizationId?: string } | null;
  onExternalSearchHandled?: () => void;
}) {
  const initialViewState = useMemo(() => loadCommitSearchViewState(), []);
  const [organizationId, setOrganizationId] = useState(() =>
    organizations.some((organization) => organization.id === initialViewState.organizationId)
      ? initialViewState.organizationId
      : organizations[0]?.id ?? "",
  );
  const [query, setQuery] = useState(initialViewState.query);
  const [author, setAuthor] = useState(initialViewState.author);
  const [branch, setBranch] = useState(initialViewState.branch);
  const [fromDate, setFromDate] = useState(initialViewState.fromDate);
  const [toDate, setToDate] = useState(initialViewState.toDate);
  const [projectId, setProjectId] = useState(initialViewState.projectId);
  const [repositoryId, setRepositoryId] = useState(initialViewState.repositoryId);
  const [validationError, setValidationError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: searchCommits,
  });

  const selectedOrganizationId = organizationId || organizations[0]?.id || "";
  const repositoriesQuery = useQuery({
    queryKey: ["commitRepositories", selectedOrganizationId],
    queryFn: () => listCommitRepositories({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
    staleTime: 5 * 60_000,
  });
  const repositoryOptions = repositoriesQuery.data ?? [];
  const projectOptions = useMemo(() => uniqueCommitProjects(repositoryOptions), [repositoryOptions]);
  const filteredRepositoryOptions = useMemo(
    () =>
      projectId
        ? repositoryOptions.filter((repository) => repository.projectId === projectId)
        : repositoryOptions,
    [projectId, repositoryOptions],
  );
  const results = mutation.data ?? [];
  const activeSearchFilterCount =
    (query.trim() ? 1 : 0) +
    (author.trim() ? 1 : 0) +
    (branch.trim() ? 1 : 0) +
    (fromDate ? 1 : 0) +
    (toDate ? 1 : 0) +
    (projectId ? 1 : 0) +
    (repositoryId ? 1 : 0);

  useEffect(() => {
    if (!organizationId && organizations[0]) {
      setOrganizationId(organizations[0].id);
    }
  }, [organizationId, organizations]);

  useEffect(() => {
    storeCommitSearchViewState({
      author,
      branch,
      fromDate,
      organizationId: selectedOrganizationId,
      projectId,
      query,
      repositoryId,
      toDate,
    });
  }, [author, branch, fromDate, projectId, query, repositoryId, selectedOrganizationId, toDate]);

  useEffect(() => {
    if (
      repositoryId &&
      !filteredRepositoryOptions.some((repository) => repository.repositoryId === repositoryId)
    ) {
      setRepositoryId("");
    }
  }, [filteredRepositoryOptions, repositoryId]);

  useEffect(() => {
    if (!externalSearch) return;
    const targetOrganizationId = externalSearch.organizationId ?? selectedOrganizationId;
    mutation.reset();
    setOrganizationId(targetOrganizationId);
    setQuery(externalSearch.query);
    setAuthor("");
    setBranch("");
    setFromDate("");
    setToDate("");
    setProjectId("");
    setRepositoryId("");
    setValidationError(null);
    mutation.mutate({
      organizationId: targetOrganizationId,
      query: externalSearch.query,
      author: "",
      branch: "",
      fromDate: "",
      toDate: "",
      projectId: "",
      repositoryId: "",
    });
    onExternalSearchHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSearch?.requestId]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.reset();
    if (fromDate && toDate && fromDate > toDate) {
      setValidationError("From date must be before or equal to To date.");
      return;
    }
    setValidationError(null);
    mutation.mutate({
      organizationId: selectedOrganizationId,
      query,
      author,
      branch,
      fromDate,
      toDate,
      projectId,
      repositoryId,
    });
  }

  function clearSearchFilters() {
    setQuery("");
    setAuthor("");
    setBranch("");
    setFromDate("");
    setToDate("");
    setProjectId("");
    setRepositoryId("");
    setValidationError(null);
    if (mutation.isSuccess) {
      mutation.mutate({
        organizationId: selectedOrganizationId,
        query: "",
        author: "",
        branch: "",
        fromDate: "",
        toDate: "",
        projectId: "",
        repositoryId: "",
      });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0 rounded-md border border-border bg-white">
        <form className="grid gap-3 p-3" onSubmit={onSubmit}>
          <div className="grid gap-3 xl:grid-cols-[minmax(240px,1fr)_180px_180px_170px_auto]">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Search</span>
              <div className="flex h-9 items-center rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
                <Search className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="message, author, repository, SHA"
                  autoFocus
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </div>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Organization</span>
              <select
                value={selectedOrganizationId}
                onChange={(event) => {
                  setOrganizationId(event.target.value);
                  setProjectId("");
                  setRepositoryId("");
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Author</span>
              <input
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                placeholder="email or name"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Branch</span>
              <input
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder="main"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={mutation.isPending || !selectedOrganizationId}
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

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[150px_150px_auto_220px_240px_1fr]">
            <label className="grid gap-2">
              <span className="text-sm font-medium">From</span>
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">To</span>
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <div className="grid gap-2">
              <span className="text-sm font-medium text-muted-foreground">Preset</span>
              <div className="flex items-center gap-1">
                {([7, 30, 90] as const).map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => {
                      const fmt = (d: Date) =>
                        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                      const to = new Date();
                      const from = new Date();
                      from.setDate(from.getDate() - days);
                      setFromDate(fmt(from));
                      setToDate(fmt(to));
                    }}
                    className="inline-flex h-9 items-center rounded-md border border-input bg-background px-2.5 text-xs hover:bg-muted"
                  >
                    {days}d
                  </button>
                ))}
              </div>
            </div>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Project</span>
              <select
                value={projectId}
                disabled={repositoriesQuery.isLoading || repositoryOptions.length === 0}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  setRepositoryId("");
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">All projects</option>
                {projectOptions.map((project) => (
                  <option key={project.projectId} value={project.projectId}>
                    {project.projectName}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Repository</span>
              <select
                value={repositoryId}
                disabled={repositoriesQuery.isLoading || filteredRepositoryOptions.length === 0}
                onChange={(event) => setRepositoryId(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">All repositories</option>
                {filteredRepositoryOptions.map((repository) => (
                  <option
                    key={`${repository.projectId}:${repository.repositoryId}`}
                    value={repository.repositoryId}
                  >
                    {projectId
                      ? repository.repositoryName
                      : `${repository.projectName} / ${repository.repositoryName}`}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end">
              <p className="pb-2 text-xs text-muted-foreground">
                {repositoriesQuery.isLoading
                  ? "Loading project filters"
                  : repositoriesQuery.isError
                    ? "Project filters unavailable"
                    : `${repositoryOptions.length} repositories available`}
              </p>
            </div>
          </div>

          {validationError ? (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          ) : null}
        </form>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        Showing locally synced data — refreshed automatically every 5 minutes.
      </p>

      {mutation.isError ? (
        <ErrorState message={commandErrorMessage(mutation.error)} />
      ) : null}

      <CommitResults
        activeExternalFilterCount={activeSearchFilterCount}
        loading={mutation.isPending}
        onClearExternalFilters={clearSearchFilters}
        results={results}
        searched={mutation.isSuccess}
      />
    </div>
  );
}

function uniqueCommitProjects(repositories: CommitRepositoryOption[]) {
  const projects = new Map<string, { projectId: string; projectName: string }>();
  for (const repository of repositories) {
    projects.set(repository.projectId, {
      projectId: repository.projectId,
      projectName: repository.projectName,
    });
  }
  return [...projects.values()].sort((a, b) => a.projectName.localeCompare(b.projectName));
}

type CommitSortKey = "date" | "repository" | "author" | "comment";
type CommitSortState = { key: CommitSortKey; direction: "asc" | "desc" };

const commitSortLabels: Record<CommitSortKey, string> = {
  date: "Date",
  comment: "Message",
  repository: "Repository",
  author: "Author",
};

const COMMIT_GRID_KEYS: CommitSortKey[] = ["date", "comment", "repository", "author"];

function defaultCommitSortDir(key: CommitSortKey): "asc" | "desc" {
  return key === "date" ? "desc" : "asc";
}

function loadCommitSort(): CommitSortState {
  const fallback: CommitSortState = { key: "date", direction: "desc" };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMMIT_SORT_STORAGE_KEY) ?? "null");
    if (
      !parsed ||
      !COMMIT_GRID_KEYS.includes(parsed.key) ||
      (parsed.direction !== "asc" && parsed.direction !== "desc")
    ) {
      return fallback;
    }
    return { key: parsed.key, direction: parsed.direction };
  } catch {
    return fallback;
  }
}

function compareCommitsByKey(a: CommitSummary, b: CommitSummary, key: CommitSortKey): number {
  switch (key) {
    case "date":
      return (a.authorDate ?? "").localeCompare(b.authorDate ?? "");
    case "repository":
      return `${a.projectName}/${a.repositoryName}`.localeCompare(`${b.projectName}/${b.repositoryName}`);
    case "author":
      return (a.authorName ?? "").localeCompare(b.authorName ?? "");
    case "comment":
      return a.comment.localeCompare(b.comment);
  }
}

function CommitSortHeaderButton({
  column,
  sort,
  onSort,
  resizeHandle,
}: {
  column: CommitSortKey;
  sort: CommitSortState;
  onSort: (column: CommitSortKey) => void;
  resizeHandle?: ReactNode;
}) {
  const active = sort.key === column;
  const label = commitSortLabels[column];
  return (
    <div
      role="columnheader"
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className="relative min-w-0"
    >
      <button
        type="button"
        aria-label={`Sort by ${label}`}
        onClick={() => onSort(column)}
        className={`flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring ${
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
      {resizeHandle}
    </div>
  );
}

const CommitGridRow = forwardRef<
  HTMLDivElement,
  {
    commit: CommitSummary;
    selected: boolean;
    columnTemplate: string;
    onSelect: () => void;
  }
>(({ commit, selected, columnTemplate, onSelect }, ref) => {
  const message = commit.comment.split(/\r?\n/, 1)[0] || "(no comment)";
  return (
    <div
      ref={ref}
      tabIndex={selected ? 0 : -1}
      role="row"
      aria-selected={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (e.key === "Enter" && commit.webUrl) {
          e.stopPropagation();
          openExternalUrl(commit.webUrl);
        }
      }}
      className={`grid h-[29px] cursor-pointer select-none items-center gap-2 border-b border-border px-2 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
        selected ? "bg-secondary" : "hover:bg-muted/50"
      }`}
      style={{ gridTemplateColumns: columnTemplate }}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (commit.webUrl) openExternalUrl(commit.webUrl); }}
        className="truncate text-left font-mono text-xs text-primary hover:underline"
        title={commit.commitId}
      >
        {commit.shortCommitId}
      </button>
      <span
        className="text-xs text-muted-foreground"
        title={commit.authorDate ? formatDate(commit.authorDate) : undefined}
      >
        {commit.authorDate ? formatRelativeDate(commit.authorDate) : "—"}
      </span>
      <span className="truncate font-medium text-foreground" title={commit.comment}>
        {message}
      </span>
      <span className="truncate text-xs text-muted-foreground" title={`${commit.projectName} / ${commit.repositoryName}`}>
        {commit.projectName} / {commit.repositoryName}
      </span>
      <span className="truncate text-xs text-muted-foreground" title={commit.authorName ?? undefined}>
        {commit.authorName ?? "—"}
      </span>
    </div>
  );
});
CommitGridRow.displayName = "CommitGridRow";

function CommitResults({
  activeExternalFilterCount = 0,
  loading,
  onClearExternalFilters,
  results,
  searched,
}: {
  activeExternalFilterCount?: number;
  loading: boolean;
  onClearExternalFilters?: () => void;
  results: CommitSummary[];
  searched: boolean;
}) {
  const [sort, setCommitSort] = useState<CommitSortState>(() => loadCommitSort());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [columnWidths, setColumnWidths] = useState(() =>
    storedNumbers(COMMIT_COLUMN_WIDTHS_STORAGE_KEY, DEFAULT_COMMIT_COLUMN_WIDTHS, COMMIT_COLUMN_MIN_WIDTHS, COMMIT_COLUMN_MAX_WIDTHS),
  );
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const restoreFocusRef = useRef(false);
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);
  const [gridViewport, setGridViewport] = useState({ height: 0, scrollTop: 0 });

  useEffect(() => {
    localStorage.setItem(COMMIT_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

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

  const commitColTemplate = gridColumnTemplate(columnWidths, 2);

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
    // Single-letter shortcuts must not swallow app-level chords (Ctrl+K etc.).
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "ArrowDown") { e.preventDefault(); moveSelection(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSelection(-1); }
    else if (e.key === "Home") { e.preventDefault(); moveSelectionTo(0); }
    else if (e.key === "End") { e.preventDefault(); moveSelectionTo(sorted.length - 1); }
    else if (e.key === "PageDown") { e.preventDefault(); moveSelection(10); }
    else if (e.key === "PageUp") { e.preventDefault(); moveSelection(-10); }
    else if (e.key === "Enter") {
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
    }
  }

  const countLabel = useMemo(() => {
    if (loading) return "Searching";
    if (!searched) return "Ready";
    return `${results.length} commit${results.length === 1 ? "" : "s"}`;
  }, [loading, results.length, searched]);
  const activeFilterCount = Math.max(0, activeExternalFilterCount);
  const hasActiveFilters = activeFilterCount > 0;

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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-base font-semibold">Results</h2>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          {countLabel}
          {hasActiveFilters ? (
            <>
              <span>{activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active</span>
              <button
                type="button"
                onClick={onClearExternalFilters}
                className="rounded border border-border bg-white px-2 py-0.5 text-xs hover:bg-secondary"
              >
                Clear filters
              </button>
            </>
          ) : null}
          <ShortcutHint>Alt+G</ShortcutHint>
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
          <div ref={setScrollerEl} className="min-h-0 flex-1 overflow-auto">
          <div className="min-w-[680px]">
            <div
              role="row"
              className="grid items-center gap-2 border-b border-border bg-gray-50 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              style={{ gridTemplateColumns: commitColTemplate }}
            >
              <div role="columnheader" className="relative min-w-0 truncate px-1">
                SHA
                <ColumnResizeHandle columnIndex={0} widths={columnWidths} setWidths={setColumnWidths} min={COMMIT_COLUMN_MIN_WIDTHS[0]} max={COMMIT_COLUMN_MAX_WIDTHS[0]} />
              </div>
              {COMMIT_GRID_KEYS.map((col, i) => (
                <CommitSortHeaderButton
                  key={col}
                  column={col}
                  sort={sort}
                  onSort={applySort}
                  resizeHandle={
                    i < COMMIT_GRID_KEYS.length - 1 ? (
                      <ColumnResizeHandle
                        columnIndex={i + 1}
                        widths={columnWidths}
                        setWidths={setColumnWidths}
                        min={COMMIT_COLUMN_MIN_WIDTHS[i + 1]}
                        max={COMMIT_COLUMN_MAX_WIDTHS[i + 1]}
                      />
                    ) : undefined
                  }
                />
              ))}
            </div>
            {loading ? (
              <div className="flex min-h-32 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
              </div>
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
      {copyToast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-3 py-1 text-xs text-background shadow-lg">
          {copyToast}
        </div>
      )}
    </div>
  );
}
