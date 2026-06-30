import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, Info, Loader2, Search, SlidersHorizontal } from "lucide-react";
import {
  searchCommits,
  listCommitRepositories,
  commandErrorMessage,
  type SearchCommitsInput,
  type CommitSummary,
} from "@/lib/azdoCommands";
import { useActiveOrganizationId } from "@/lib/useActiveConnection";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { ErrorState } from "@/components/StateDisplay";
import { CommitActivityHeatmap } from "./CommitActivityHeatmap";
import { extractCommitQuery } from "./commitQuery";
import { CommitResults } from "./CommitResults";
import { type CommitViewMode, COMMIT_VIEW_MODE_STORAGE_KEY } from "./commitSearchConstants";
import {
  loadCommitSearchViewState,
  storeCommitSearchViewState,
  loadCommitViewMode,
  uniqueCommitProjects,
} from "./commitSearchUtils";
import { CommitViewToggle } from "./CommitViewToggle";

export function CommitSearch({
  externalSearch,
  onExternalSearchHandled,
  onOpenPullRequest,
}: {
  externalSearch?: { query: string; requestId: number; organizationId?: string } | null;
  onExternalSearchHandled?: () => void;
  onOpenPullRequest?: (query: string, organizationId?: string) => void;
}) {
  const initialViewState = useMemo(() => loadCommitSearchViewState(), []);
  const selectedOrganizationId = useActiveOrganizationId();
  const [query, setQuery] = useState(initialViewState.query);
  const [author, setAuthor] = useState(initialViewState.author);
  const [branch, setBranch] = useState(initialViewState.branch);
  const [fromDate, setFromDate] = useState(initialViewState.fromDate);
  const [toDate, setToDate] = useState(initialViewState.toDate);
  const [projectIds, setProjectIds] = useState<string[]>(initialViewState.projectIds);
  const [repositoryIds, setRepositoryIds] = useState<string[]>(initialViewState.repositoryIds);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<CommitViewMode>(() => loadCommitViewMode());
  const [filtersOpen, setFiltersOpen] = useState(
    () =>
      !!(
        initialViewState.author.trim() ||
        initialViewState.branch.trim() ||
        initialViewState.fromDate ||
        initialViewState.toDate
      ),
  );

  // Accumulated commits across Load more pages.
  const [allCommits, setAllCommits] = useState<CommitSummary[]>([]);
  // True when the pending mutation is a "load more" append rather than a new search.
  const isLoadMoreRef = useRef(false);
  // Last search params saved so Load more can re-issue the same query with a higher offset.
  const lastSearchInputRef = useRef<SearchCommitsInput | null>(null);

  const mutation = useMutation({
    mutationFn: searchCommits,
    onSuccess(data) {
      if (isLoadMoreRef.current) {
        setAllCommits((prev) => [...prev, ...data.commits]);
      } else {
        setAllCommits(data.commits);
      }
      isLoadMoreRef.current = false;
    },
  });

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
      projectIds.length > 0
        ? repositoryOptions.filter((repository) => projectIds.includes(repository.projectId))
        : repositoryOptions,
    [projectIds, repositoryOptions],
  );
  const totalMatches = mutation.data?.total ?? allCommits.length;
  const resultsTruncated = mutation.data?.truncated ?? false;
  // Build author autocomplete suggestions from already-fetched commits.
  const authorSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of allCommits) {
      for (const v of [c.authorName, c.authorEmail]) {
        if (v && !seen.has(v)) { seen.add(v); out.push(v); }
      }
      if (out.length >= 30) break;
    }
    return out;
  }, [allCommits]);
  const advancedFilterCount =
    (author.trim() ? 1 : 0) +
    (branch.trim() ? 1 : 0) +
    (fromDate ? 1 : 0) +
    (toDate ? 1 : 0);
  const activeSearchFilterCount =
    (query.trim() ? 1 : 0) +
    advancedFilterCount +
    (projectIds.length > 0 ? 1 : 0) +
    (repositoryIds.length > 0 ? 1 : 0);

  useEffect(() => {
    storeCommitSearchViewState({
      author,
      branch,
      fromDate,
      organizationId: selectedOrganizationId,
      projectIds,
      query,
      repositoryIds,
      toDate,
    });
  }, [author, branch, fromDate, projectIds, query, repositoryIds, selectedOrganizationId, toDate]);

  useEffect(() => {
    window.localStorage.setItem(COMMIT_VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  // Drop repository selections that no longer belong to the selected projects.
  // Skip while repositories are still loading (or unavailable) so a restored
  // selection is not wiped before its options exist.
  useEffect(() => {
    if (repositoriesQuery.isLoading || repositoryOptions.length === 0) return;
    const allowed = new Set(filteredRepositoryOptions.map((repository) => repository.repositoryId));
    setRepositoryIds((prev) => {
      const next = prev.filter((id) => allowed.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [filteredRepositoryOptions, repositoriesQuery.isLoading, repositoryOptions.length]);

  useEffect(() => {
    if (!externalSearch) return;
    const targetOrganizationId = selectedOrganizationId;
    mutation.reset();
    setQuery(externalSearch.query);
    setAuthor("");
    setBranch("");
    setFromDate("");
    setToDate("");
    setProjectIds([]);
    setRepositoryIds([]);
    setValidationError(null);
    setAllCommits([]);
    const externalInput: SearchCommitsInput = {
      organizationId: targetOrganizationId,
      query: externalSearch.query,
      author: "",
      branch: "",
      fromDate: "",
      toDate: "",
      projectIds: undefined,
      repositoryIds: undefined,
    };
    isLoadMoreRef.current = false;
    lastSearchInputRef.current = externalInput;
    mutation.mutate(externalInput);
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
    const { keyword, itemPath } = extractCommitQuery(query);
    if ((branch.trim() || itemPath) && repositoryIds.length !== 1) {
      setValidationError(
        itemPath
          ? "Select a single repository to filter commits by path (path: is applied on the server)."
          : "Select a single repository to search a specific branch.",
      );
      return;
    }
    setValidationError(null);
    const searchInput: SearchCommitsInput = {
      organizationId: selectedOrganizationId,
      query: keyword,
      author,
      branch,
      itemPath: itemPath ?? undefined,
      fromDate,
      toDate,
      projectIds: projectIds.length > 0 ? projectIds : undefined,
      repositoryIds: repositoryIds.length > 0 ? repositoryIds : undefined,
    };
    isLoadMoreRef.current = false;
    lastSearchInputRef.current = searchInput;
    mutation.mutate(searchInput);
  }

  function clearSearchFilters() {
    setQuery("");
    setAuthor("");
    setBranch("");
    setFromDate("");
    setToDate("");
    setProjectIds([]);
    setRepositoryIds([]);
    setValidationError(null);
    setAllCommits([]);
    if (mutation.isSuccess) {
      const clearInput: SearchCommitsInput = {
        organizationId: selectedOrganizationId,
        query: "",
        author: "",
        branch: "",
        fromDate: "",
        toDate: "",
        projectIds: undefined,
        repositoryIds: undefined,
      };
      isLoadMoreRef.current = false;
      lastSearchInputRef.current = clearInput;
      mutation.mutate(clearInput);
    }
  }

  function handleLoadMore() {
    if (!lastSearchInputRef.current || !resultsTruncated) return;
    isLoadMoreRef.current = true;
    mutation.mutate({ ...lastSearchInputRef.current, offset: allCommits.length });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0 rounded-md border border-border bg-card">
        <form className="grid gap-3 p-3" onSubmit={onSubmit}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(200px,1fr)_minmax(220px,1fr)_auto]">
            <div className="grid gap-2">
              <span className="text-sm font-medium">Project</span>
              <MultiSelectFilter
                options={projectOptions.map((project) => ({
                  value: project.projectId,
                  label: project.projectName,
                }))}
                selected={projectIds}
                onChange={setProjectIds}
                placeholder="All projects"
                ariaLabel="Filter by project"
                searchable
                disabled={repositoriesQuery.isLoading || repositoryOptions.length === 0}
              />
            </div>

            <div className="grid gap-2">
              <span className="text-sm font-medium">Repository</span>
              <MultiSelectFilter
                options={filteredRepositoryOptions.map((repository) => ({
                  value: repository.repositoryId,
                  label:
                    projectIds.length > 0
                      ? repository.repositoryName
                      : `${repository.projectName} / ${repository.repositoryName}`,
                }))}
                selected={repositoryIds}
                onChange={setRepositoryIds}
                placeholder="All repositories"
                ariaLabel="Filter by repository"
                searchable
                disabled={repositoriesQuery.isLoading || filteredRepositoryOptions.length === 0}
              />
            </div>

            <div className="flex items-end">
              <p className="pb-2 text-xs text-muted-foreground">
                {repositoriesQuery.isLoading
                  ? "Loading repositories"
                  : repositoriesQuery.isError
                    ? (
                      <>
                        Repositories unavailable{" "}
                        <button
                          type="button"
                          onClick={() => void repositoriesQuery.refetch()}
                          className="rounded-sm underline hover:no-underline focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          Retry
                        </button>
                      </>
                    )
                    : `${repositoryOptions.length} repositories available`}
              </p>
            </div>
          </div>

          <div className="flex items-end gap-2">
            <label className="grid min-w-0 flex-1 gap-2">
              <span className="text-sm font-medium">Search</span>
              <div className="flex h-9 items-center rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
                <Search className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="message, author, SHA — or path:src/auth"
                  aria-label="Filter"
                  autoFocus
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </div>
            </label>

            <button
              type="button"
              onClick={() => setFiltersOpen((value) => !value)}
              aria-expanded={filtersOpen}
              aria-controls="commit-advanced-filters"
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              Filters
              {advancedFilterCount > 0 ? (
                <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
                  {advancedFilterCount}
                </span>
              ) : null}
              <ChevronDown
                className={`h-4 w-4 transition-transform ${filtersOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>

            <button
              type="submit"
              disabled={mutation.isPending || !selectedOrganizationId}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Search className="h-4 w-4" aria-hidden="true" />
              )}
              Search
            </button>
          </div>

          {filtersOpen ? (
          <div
            id="commit-advanced-filters"
            className="grid gap-3 border-t border-border pt-3 md:grid-cols-2 xl:grid-cols-[minmax(160px,1fr)_minmax(120px,180px)_150px_150px_auto]"
          >
            <label className="grid gap-2">
              <span className="text-sm font-medium">Author</span>
              <input
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                placeholder="email or name"
                list={authorSuggestions.length > 0 ? "commit-author-suggestions" : undefined}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              {authorSuggestions.length > 0 ? (
                <datalist id="commit-author-suggestions">
                  {authorSuggestions.map((s) => <option key={s} value={s} />)}
                </datalist>
              ) : null}
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

            <p className="text-xs text-muted-foreground md:col-span-2 xl:col-span-5">
              Tip: add{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">path:src/auth</code> to filter
              by changed path. Path filtering runs on the server, so select a repository first.
            </p>
          </div>
          ) : null}

          {validationError ? (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          ) : null}
        </form>
      </div>

      <div className="flex items-center justify-between gap-3">
        <CommitViewToggle value={viewMode} onChange={setViewMode} />
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          Showing locally synced data — refreshed automatically every 5 minutes.
        </p>
      </div>

      {mutation.isError ? (
        <ErrorState message={commandErrorMessage(mutation.error)} />
      ) : null}

      {viewMode === "activity" ? (
        <CommitActivityHeatmap
          organizationId={selectedOrganizationId}
          author={author}
          fromDate={fromDate}
          toDate={toDate}
          projectId={projectIds.length === 1 ? projectIds[0] : ""}
          repositoryId={repositoryIds.length === 1 ? repositoryIds[0] : ""}
        />
      ) : (
        <CommitResults
          activeExternalFilterCount={activeSearchFilterCount}
          loading={mutation.isPending}
          onClearExternalFilters={clearSearchFilters}
          onLoadMore={resultsTruncated ? handleLoadMore : undefined}
          onOpenPullRequest={onOpenPullRequest}
          results={allCommits}
          total={totalMatches}
          truncated={resultsTruncated}
          searched={mutation.isSuccess}
        />
      )}
    </div>
  );
}

