import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import {
  searchCommits,
  listCommitRepositories,
  commandErrorMessage,
  type SearchCommitsInput,
  type CommitSummary,
} from "@/lib/azdoCommands";
import { useActiveOrganizationId } from "@/lib/useActiveConnection";
import { handleSearchInputEscape } from "@/lib/utils";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import {
  FilterField,
  FiltersToggle,
  SearchInput,
  SearchSubmitButton,
  filterInputClass,
  searchBarRowClass,
} from "@/components/SearchBar";
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
import { writeStoredString } from "@/lib/storage";

export function CommitSearch({
  externalSearch,
  onExternalSearchHandled,
  onOpenPullRequest,
}: {
  externalSearch?: { query: string; requestId: number; organizationId?: string } | null;
  onExternalSearchHandled?: () => void;
  onOpenPullRequest?: (query: string, organizationId?: string) => void;
}) {
  const selectedOrganizationId = useActiveOrganizationId();
  const initialViewState = useMemo(
    () => loadCommitSearchViewState(selectedOrganizationId),
    [selectedOrganizationId],
  );
  // The search text intentionally resets when the view is left (remount on nav).
  const [query, setQuery] = useState("");
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
  // Same signal as `isLoadMoreRef`, but as state so the results grid re-renders
  // and can keep the already-loaded rows on screen while the next page loads.
  const [loadingMore, setLoadingMore] = useState(false);
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
    // Clear the append flag on failure too, so a failed "load more" does not
    // leave the grid stuck in its loading-more state.
    onSettled() {
      setLoadingMore(false);
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
  const repositoryStatus = repositoriesQuery.isLoading
    ? "Loading repositories"
    : repositoriesQuery.isError
      ? null
      : `${repositoryOptions.length} repositories available`;
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
    if (!selectedOrganizationId) return;
    storeCommitSearchViewState({
      author,
      branch,
      fromDate,
      organizationId: selectedOrganizationId,
      projectIds,
      repositoryIds,
      toDate,
    });
  }, [author, branch, fromDate, projectIds, repositoryIds, selectedOrganizationId, toDate]);

  useEffect(() => {
    writeStoredString(COMMIT_VIEW_MODE_STORAGE_KEY, viewMode);
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
    if (!selectedOrganizationId) return;
    const scopedViewState = loadCommitSearchViewState(selectedOrganizationId);
    setProjectIds(scopedViewState.projectIds);
    setRepositoryIds(scopedViewState.repositoryIds);
    setAllCommits([]);
    mutation.reset();
    lastSearchInputRef.current = null;
  }, [selectedOrganizationId]);

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
    // Guard against a second click while the previous page is still in flight,
    // which would request the same offset twice and duplicate rows.
    if (mutation.isPending) return;
    isLoadMoreRef.current = true;
    setLoadingMore(true);
    mutation.mutate({ ...lastSearchInputRef.current, offset: allCommits.length });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <form className="grid shrink-0 gap-2" onSubmit={onSubmit}>
        <div className={searchBarRowClass}>
          <SearchInput
            value={query}
            onChange={setQuery}
            onKeyDown={handleSearchInputEscape}
            placeholder="message, author, SHA — or path:src/auth"
            ariaLabel="Filter"
            autoFocus
          />
          <div className="w-44">
            <MultiSelectFilter
                className="h-8"
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
          <div className="w-56" title={repositoryStatus ?? undefined}>
            <MultiSelectFilter
                className="h-8"
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
          {repositoriesQuery.isError ? (
            <span className="text-xs text-muted-foreground">
              Repositories unavailable{" "}
              <button
                type="button"
                onClick={() => void repositoriesQuery.refetch()}
                className="rounded-sm underline hover:no-underline focus:outline-none focus:ring-2 focus:ring-ring"
              >
                Retry
              </button>
            </span>
          ) : null}
          <FiltersToggle
            open={filtersOpen}
            onToggle={() => setFiltersOpen((value) => !value)}
            count={advancedFilterCount}
            controls="commit-advanced-filters"
          />
          <SearchSubmitButton pending={mutation.isPending} disabled={!selectedOrganizationId} />
          <div className="ml-auto flex items-center gap-2">
            <CommitViewToggle value={viewMode} onChange={setViewMode} />
            <span
              role="note"
              className="text-muted-foreground"
              title="Showing locally synced data — refreshed automatically every 5 minutes."
              aria-label="Showing locally synced data — refreshed automatically every 5 minutes."
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </div>
        </div>

        {filtersOpen ? (
          <div id="commit-advanced-filters" className="flex flex-wrap items-end gap-2">
            <FilterField label="Author" className="w-56">
              <input
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                onKeyDown={handleSearchInputEscape}
                placeholder="email or name"
                list={authorSuggestions.length > 0 ? "commit-author-suggestions" : undefined}
                className={filterInputClass}
              />
              {authorSuggestions.length > 0 ? (
                <datalist id="commit-author-suggestions">
                  {authorSuggestions.map((s) => <option key={s} value={s} />)}
                </datalist>
              ) : null}
            </FilterField>
            <FilterField label="Branch" className="w-40">
              <input
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                onKeyDown={handleSearchInputEscape}
                placeholder="main"
                className={filterInputClass}
              />
            </FilterField>
            <FilterField label="From">
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className={filterInputClass}
              />
            </FilterField>
            <FilterField label="To">
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                className={filterInputClass}
              />
            </FilterField>
            <div className="flex h-8 items-center gap-1">
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
                    className="inline-flex h-8 items-center rounded-md border border-input bg-background px-2.5 text-xs hover:bg-muted"
                  >
                    {days}d
                  </button>
                ))}
            </div>
            <p className="basis-full text-xs text-muted-foreground">
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
          loading={mutation.isPending && !loadingMore}
          loadingMore={loadingMore}
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
