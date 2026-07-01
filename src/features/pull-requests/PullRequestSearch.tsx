import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { GitBranch, Loader2, Plus, Search } from 'lucide-react';
import {
  searchPullRequests,
  listCommitRepositories,
  commandErrorMessage,
  type SearchPullRequestsInput,
} from '@/lib/azdoCommands';
import { useActiveOrganizationId } from '@/lib/useActiveConnection';
import { openExternalUrl } from '@/lib/openExternal';
import { ErrorState } from '@/components/StateDisplay';
import { MultiSelectFilter } from '@/components/MultiSelectFilter';
import { PullRequestResults } from './PrSearchResults';
import { CreatePullRequestForm } from './CreatePullRequestForm';
import { BranchesPanel } from './BranchesPanel';
import {
  PR_SEARCH_QUERY_STORAGE_KEY,
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

export function PullRequestSearch({
  externalSearch,
  onExternalSearchHandled,
}: {
  externalSearch?: { query: string; requestId: number; organizationId?: string } | null;
  onExternalSearchHandled?: () => void;
}) {
  const organizationId = useActiveOrganizationId();
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

  // Create-PR (#387) and Branches (#398) both need exactly one repository
  // resolved to a project, so they stay disabled under a broader selection.
  const selectedRepo =
    repositoryIds.length === 1
      ? allRepositories.find((r) => r.repositoryId === repositoryIds[0])
      : undefined;
  const [showCreatePr, setShowCreatePr] = useState(false);
  const [createPrSourceBranch, setCreatePrSourceBranch] = useState<string | undefined>(undefined);
  const [showBranches, setShowBranches] = useState(false);
  useEffect(() => {
    if (!selectedRepo) {
      setShowCreatePr(false);
      setShowBranches(false);
    }
  }, [selectedRepo]);

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
    const targetOrganizationId = organizationId;
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

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p id="pr-search-status-note" className="text-xs text-muted-foreground">
              Active pull requests are served from the local cache. Completed and
              abandoned pull requests are fetched live from Azure DevOps, so those
              statuses may take a moment. Target branch and the date window narrow
              the live query server-side.
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreatePrSourceBranch(undefined);
                  setShowCreatePr((open) => !open);
                }}
                disabled={!selectedRepo}
                aria-expanded={showCreatePr}
                title={selectedRepo ? "Create a pull request" : "Select a single repository to create a PR"}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                New pull request
              </button>
              <button
                type="button"
                onClick={() => setShowBranches((open) => !open)}
                disabled={!selectedRepo}
                aria-expanded={showBranches}
                title={selectedRepo ? "Show branches for the selected repository" : "Select a single repository to list its branches"}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <GitBranch className="h-4 w-4" aria-hidden="true" />
                Branches
              </button>
            </div>
          </div>
        </form>
      </div>

      {showCreatePr && selectedRepo ? (
        <CreatePullRequestForm
          organizationId={organizationId}
          projectId={selectedRepo.projectId}
          repositoryId={selectedRepo.repositoryId}
          initialSourceBranch={createPrSourceBranch}
          onClose={() => setShowCreatePr(false)}
        />
      ) : null}

      {showBranches && selectedRepo ? (
        <BranchesPanel
          organizationId={organizationId}
          project={selectedRepo.projectId}
          repository={selectedRepo.repositoryId}
          onOpenPullRequest={(url) => openExternalUrl(url)}
          onCreatePrFromBranch={(branchName) => {
            setCreatePrSourceBranch(branchName);
            setShowCreatePr(true);
          }}
        />
      ) : null}

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
