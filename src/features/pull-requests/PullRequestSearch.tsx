import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { type PullRequestSummary } from '@/lib/azdoCommands';
import { useActiveOrganization } from '@/lib/useActiveConnection';
import { handleSearchInputEscape, isImeComposing } from '@/lib/utils';
import { parsePrSearchQuery } from '@/lib/prSearchQuery';
import { ErrorState } from '@/components/StateDisplay';
import { SearchInput, SearchSubmitButton } from '@/components/SearchBar';
import { useSearchHistory } from '@/lib/searchHistory';
import { PullRequestResults } from './PrSearchResults';
import { PrSearchHistory } from './PrSearchHistory';
import { PrSearchFiltersDialog } from './PrSearchFiltersDialog';
import { PrSearchFilterChips } from './PrSearchFilterChips';
import { normalizePrSearchFilters, type PrSearchFilters, summarizePrSearchFilters } from './prSearchHistoryHelpers';
import { initialPrSearchFilters, prSearchInput, sortPrSearchRows } from './prSearchState';
import { useProgressivePrSearch } from './useProgressivePrSearch';
import { PR_SEARCH_STATUS_STORAGE_KEY, PR_SEARCH_DATE_BASIS_STORAGE_KEY, PR_SEARCH_SORT_STORAGE_KEY, type PrSearchSortBy } from './PrSearchTypes';

export function PullRequestSearch({ externalSearch, onExternalSearchHandled }: {
  externalSearch?: { query: string; requestId: number; organizationId?: string; pullRequest?: PullRequestSummary } | null;
  onExternalSearchHandled?: () => void;
}) {
  const organization = useActiveOrganization();
  const organizationId = organization.data?.id ?? '';
  const azure = organization.data?.providerKind !== 'github';
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(initialPrSearchFilters);
  const [filterAnchor, setFilterAnchor] = useState<DOMRect | null>(null);
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [selectionEpoch, setSelectionEpoch] = useState(0);
  const search = useProgressivePrSearch(organizationId, azure);
  const searchHistory = useSearchHistory<PrSearchFilters>('prSearch');
  const priorOrg = useRef(organizationId);
  const dirty = query !== submittedQuery;
  const results = useMemo(() => sortPrSearchRows(search.rows, filters.sortBy), [search.rows, filters.sortBy]);

  useEffect(() => {
    if (!organizationId || priorOrg.current === organizationId) return;
    const switched = !!priorOrg.current;
    priorOrg.current = organizationId;
    const next = initialPrSearchFilters();
    if (!azure && !window.localStorage.getItem(PR_SEARCH_STATUS_STORAGE_KEY)) next.statuses = ['active'];
    setFilters(next);
    if (switched) { setQuery(''); setSubmittedQuery(''); }
    setFilterAnchor(null); setValidationError(null); setSelectionEpoch((value) => value + 1);
  }, [organizationId, azure]);

  function saveFilters(next: PrSearchFilters) {
    setFilters(next);
    window.localStorage.setItem(PR_SEARCH_STATUS_STORAGE_KEY, JSON.stringify(next.statuses));
    window.localStorage.setItem(PR_SEARCH_DATE_BASIS_STORAGE_KEY, next.dateBasis);
    window.localStorage.setItem(PR_SEARCH_SORT_STORAGE_KEY, next.sortBy);
  }

  function runSearch(text: string, nextFilters: PrSearchFilters) {
    if (!organizationId) return;
    const next = normalizePrSearchFilters(nextFilters);
    if (azure) {
      try { parsePrSearchQuery(text, next.excludeWords); }
      catch (error) { setValidationError(error instanceof Error ? error.message : String(error)); return; }
    }
    setValidationError(null); setQuery(text); setSubmittedQuery(text); saveFilters(next); setSelectionEpoch((value) => value + 1);
    const input = prSearchInput(text, next);
    if (!azure) { delete input.authorId; delete input.reviewerId; delete input.excludeWords; }
    search.start(input);
    searchHistory.record({ organizationId, query: text, filters: next, summary: summarizePrSearchFilters(next) });
  }

  useEffect(() => {
    if (!externalSearch || !organizationId) return;
    if (externalSearch.organizationId && externalSearch.organizationId !== organizationId) return;
    const next = { ...initialPrSearchFilters(), statuses: ['active'] as PrSearchFilters['statuses'] };
    setQuery(externalSearch.query); setSubmittedQuery(externalSearch.query); setFilters(next); setValidationError(null); setSelectionEpoch((value) => value + 1);
    if (externalSearch.pullRequest) search.openSummary(externalSearch.pullRequest);
    else search.start(prSearchInput(externalSearch.query, next));
    onExternalSearchHandled?.();
    // The request id identifies a new palette navigation; callback identities do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSearch?.requestId, organizationId]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!search.pending) runSearch(query, filters);
  }
  function clearFilters() {
    runSearch('', { ...initialPrSearchFilters(), statuses: filters.statuses, sortBy: filters.sortBy });
  }
  const activeCount = (query.trim() ? 1 : 0) + (filters.author ? 1 : 0) + (filters.reviewer ? 1 : 0)
    + (filters.projectIds.length ? 1 : 0) + (filters.repositoryIds.length ? 1 : 0) + (filters.targetBranches.length ? 1 : 0)
    + (filters.fromDate ? 1 : 0) + (filters.toDate ? 1 : 0) + (filters.excludeDrafts ? 1 : 0) + (filters.excludeWords ? 1 : 0);
  const progressive = search.result?.searchComplete !== undefined || (azure && search.pending);
  const searchState = { progressive, scannedCount: search.result?.scannedCount ?? 0,
    complete: search.result?.searchComplete ?? false, hasMore: search.result?.hasMore ?? false,
    retryAvailable: (search.result?.failedScopes?.length ?? 0) > 0,
    dirty, stopping: search.stopping,
    onContinue: () => search.continueSearch(), onRetry: () => search.continueSearch(true), onStop: () => void search.stop() };

  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <form className="grid shrink-0 gap-1.5" onSubmit={submit}>
      <div className="flex items-center gap-2">
        <SearchInput value={query} onChange={(value) => { setQuery(value); setValidationError(null); }} placeholder="Search pull requests…" autoFocus
          onKeyDown={(event) => {
            if (isImeComposing(event.nativeEvent) && event.key === 'Enter') { event.preventDefault(); return; }
            handleSearchInputEscape(event);
          }} />
        <button type="button" onClick={(event) => setFilterAnchor(event.currentTarget.getBoundingClientRect())} aria-expanded={!!filterAnchor}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-sm hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring">
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />Filters
        </button>
        <SearchSubmitButton pending={search.pending} disabled={!organizationId} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PrSearchFilterChips filters={filters} onOpen={(owner) => setFilterAnchor(owner.getBoundingClientRect())} onChange={(next) => runSearch(query, next)} />
        {dirty && search.searched ? <span role="status" className="text-2xs text-warning">Press Enter to search</span> : null}
      </div>
    </form>
    {validationError ? <p role="alert" className="text-xs text-destructive">{validationError}</p> : null}
    {search.error ? <ErrorState message={search.error} /> : null}
    {search.result?.warnings.length ? <p role="status" className="shrink-0 text-xs text-warning">Incomplete results: {search.result.warnings.join('; ')}</p> : null}
    <PullRequestResults filterResetKey={selectionEpoch} activeExternalFilterCount={activeCount} loading={search.pending}
      failed={!!search.error}
      onClearExternalFilters={clearFilters} results={results} searched={search.searched}
      truncated={search.result?.truncated ?? false} total={search.result?.total ?? 0}
      progress={searchState} sortBy={filters.sortBy} onSortChange={(sortBy: PrSearchSortBy) => saveFilters({ ...filters, sortBy })}
      emptyContent={<PrSearchHistory organizationId={organizationId} history={searchHistory} onRun={runSearch} />} />
    {filterAnchor ? <PrSearchFiltersDialog key={organizationId} organizationId={organizationId} azure={azure} filters={filters} anchor={filterAnchor}
      onClose={() => setFilterAnchor(null)} onApply={(next) => { setFilterAnchor(null); runSearch(query, next); }} /> : null}
  </div>;
}
