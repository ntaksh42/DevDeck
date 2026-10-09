import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import {
  searchPullRequests,
  listRepositories,
  listRepoBranches,
  commandErrorMessage,
  type SearchPullRequestsInput,
  type PullRequestSummary,
} from '@/lib/azdoCommands';
import { useActiveOrganizationId } from '@/lib/useActiveConnection';
import { handleSearchInputEscape } from '@/lib/utils';
import { ErrorState } from '@/components/StateDisplay';
import { MultiSelectFilter } from '@/components/MultiSelectFilter';
import {
  FilterField,
  FiltersToggle,
  NativeSelect,
  SearchInput,
  SearchSubmitButton,
  filterInputClass,
  searchBarRowClass,
} from '@/components/SearchBar';
import { PullRequestResults } from './PrSearchResults';
import {
  PR_SEARCH_STATUS_OPTIONS,
  PR_SEARCH_STATUS_STORAGE_KEY,
  PR_SEARCH_DATE_BASIS_OPTIONS,
  PR_SEARCH_DATE_BASIS_STORAGE_KEY,
  PR_SEARCH_SORT_OPTIONS,
  PR_SEARCH_SORT_STORAGE_KEY,
  loadPrSearchStatuses,
  loadPrSearchDateBasis,
  loadPrSearchSortBy,
  type PrSearchStatus,
  type PrSearchDateBasis,
  type PrSearchSortBy,
} from './PrSearchTypes';

// Shared empty fallback so `results` keeps a stable identity between renders
// while no search has run; PrSearchResults resets its selection when the
// results array changes.
const NO_RESULTS: PullRequestSummary[] = [];

const PR_SEARCH_NOTE =
  "Active pull requests are served from the local cache. Completed and abandoned pull requests are fetched live from Azure DevOps, so those statuses may take a moment. Target branch and the date window narrow the live query server-side. Select a repository to get target-branch suggestions.";

export function PullRequestSearch({
  externalSearch,
  onExternalSearchHandled,
}: {
  externalSearch?: { query: string; requestId: number; organizationId?: string } | null;
  onExternalSearchHandled?: () => void;
}) {
  const organizationId = useActiveOrganizationId();
  // The search text intentionally resets when the view is left (remount on nav).
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<PrSearchStatus[]>(loadPrSearchStatuses);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [repositoryIds, setRepositoryIds] = useState<string[]>([]);
  const [targetBranches, setTargetBranches] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [dateBasis, setDateBasis] = useState<PrSearchDateBasis>(loadPrSearchDateBasis);
  const [sortBy, setSortBy] = useState<PrSearchSortBy>(loadPrSearchSortBy);
  const [excludeDrafts, setExcludeDrafts] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const repositoriesQuery = useQuery({
    queryKey: ["prRepositories", organizationId],
    queryFn: () => listRepositories({ organizationId }),
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

  // Fetch branches for the selected repositories so the target-branch field can
  // suggest real branch names. Scoped to the selected repos to avoid fanning out
  // across every repository in the org when nothing is narrowed.
  const selectedRepositories = useMemo(
    () => allRepositories.filter((r) => repositoryIds.includes(r.repositoryId)),
    [allRepositories, repositoryIds],
  );
  const branchQueries = useQueries({
    queries: selectedRepositories.map((repo) => ({
      queryKey: ["prBranchSuggestions", organizationId, repo.projectId, repo.repositoryId],
      queryFn: () =>
        listRepoBranches({
          organizationId,
          project: repo.projectId,
          repository: repo.repositoryId,
        }),
      enabled: !!organizationId,
      staleTime: 5 * 60_000,
    })),
  });
  const branchSuggestions = Array.from(
    new Set(branchQueries.flatMap((q) => (q.data ?? []).map((b) => b.name))),
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
  const results = mutation.data?.pullRequests ?? NO_RESULTS;
  const truncated = mutation.data?.truncated ?? false;
  const total = mutation.data?.total ?? 0;
  const activeSearchFilterCount =
    (query.trim() ? 1 : 0) +
    (projectIds.length > 0 ? 1 : 0) +
    (repositoryIds.length > 0 ? 1 : 0) +
    (targetBranches.length > 0 ? 1 : 0) +
    (fromDate ? 1 : 0) +
    (toDate ? 1 : 0) +
    (excludeDrafts ? 1 : 0);
  const advancedFilterCount =
    (targetBranches.length > 0 ? 1 : 0) +
    (fromDate ? 1 : 0) +
    (toDate ? 1 : 0) +
    (excludeDrafts ? 1 : 0);

  // Bundles the advanced filter state shared by every search trigger.
  function advancedFilters(): Partial<SearchPullRequestsInput> {
    return {
      targetBranches: targetBranches.length > 0 ? targetBranches : undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      dateBasis,
      excludeDrafts: excludeDrafts || undefined,
      sortBy,
    };
  }

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
    const targetOrganizationId = organizationId;
    setQuery(externalSearch.query);
    // The palette looks up active PRs, so reset the status and scope filters.
    setStatuses(["active"]);
    setProjectIds([]);
    setRepositoryIds([]);
    setTargetBranches([]);
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
    setTargetBranches([]);
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
      <form className="grid shrink-0 gap-2" onSubmit={onSubmit}>
        <div className={searchBarRowClass}>
          <SearchInput
            value={query}
            onChange={setQuery}
            onKeyDown={handleSearchInputEscape}
            placeholder="title, author, branch…"
            autoFocus
          />
          <div className="w-36">
            <MultiSelectFilter
              className="h-8"
              options={PR_SEARCH_STATUS_OPTIONS}
              selected={statuses}
              onChange={(next) => setStatuses(next as PrSearchStatus[])}
              placeholder="Active"
              ariaLabel="Filter by status"
              capitalize
            />
          </div>
          <div className="w-44">
            <MultiSelectFilter
              className="h-8"
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              selected={projectIds}
              onChange={onProjectsChange}
              placeholder="All projects"
              ariaLabel="Filter by project"
              searchable
              disabled={repositoriesQuery.isLoading}
            />
          </div>
          <div className="w-52">
            <MultiSelectFilter
              className="h-8"
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
          <FiltersToggle
            open={filtersOpen}
            onToggle={() => setFiltersOpen((open) => !open)}
            count={advancedFilterCount}
            controls="pr-search-advanced-filters"
          />
          <SearchSubmitButton pending={mutation.isPending} disabled={!organizationId} />
          <span
            className="text-muted-foreground"
            title={PR_SEARCH_NOTE}
            aria-describedby="pr-search-status-note"
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </div>

        {filtersOpen ? (
          <div id="pr-search-advanced-filters" className="flex flex-wrap items-end gap-2">
            <div className="grid w-64 gap-0.5">
              <span className="text-[11px] font-medium text-muted-foreground">Target branches</span>
              <MultiSelectFilter
                className="h-8"
                options={branchSuggestions.map((branch) => ({ value: branch, label: branch }))}
                selected={targetBranches}
                onChange={setTargetBranches}
                placeholder="All branches"
                ariaLabel="Filter by target branch"
                searchable
                disabled={branchQueries.length === 0 || branchSuggestions.length === 0}
              />
            </div>
            <FilterField label="From">
              <input
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => setFromDate(e.target.value)}
                className={filterInputClass}
              />
            </FilterField>
            <FilterField label="To">
              <input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => setToDate(e.target.value)}
                className={filterInputClass}
              />
            </FilterField>
            <FilterField label="Date basis">
              <NativeSelect
                className="w-36"
                value={dateBasis}
                onChange={(e) => setDateBasis(e.target.value as PrSearchDateBasis)}
                title={statuses.length === 0 || statuses.includes("active")
                  ? "Active PRs have no close date, so the window uses the created date for them."
                  : "Whether the date window filters by created or closed date."}
              >
                {PR_SEARCH_DATE_BASIS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </NativeSelect>
            </FilterField>
            <FilterField label="Sort by">
              <NativeSelect
                className="w-40"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as PrSearchSortBy)}
              >
                {PR_SEARCH_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </NativeSelect>
            </FilterField>
            <label className="flex h-8 items-center gap-2">
              <input
                type="checkbox"
                checked={excludeDrafts}
                onChange={(e) => setExcludeDrafts(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-xs font-medium">Hide drafts</span>
            </label>
          </div>
        ) : null}

        {/* Kept for assistive tech; sighted users get it from the info icon's tooltip. */}
        <p id="pr-search-status-note" className="sr-only">
          {PR_SEARCH_NOTE}
        </p>
      </form>

      {mutation.isError && <ErrorState message={commandErrorMessage(mutation.error)} />}

      {mutation.isSuccess && mutation.data.warnings.length > 0 && (
        <p role="status" className="shrink-0 text-xs text-amber-600 dark:text-amber-400">
          Could not fetch {mutation.data.warnings.length} project(s): {mutation.data.warnings.join(", ")}.
        </p>
      )}

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
