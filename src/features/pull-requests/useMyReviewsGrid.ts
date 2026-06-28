import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  commandErrorMessage,
  getAppSettings,
  listMyReviewPullRequests,
  prLocator,
  snoozeItem,
  submitPullRequestVote,
  type ReviewPullRequestSummary,
} from '@/lib/azdoCommands';
import { useActiveOrganizationId } from '@/lib/useActiveConnection';
import { matchesAllSearchTerms, splitSearchTerms, storedNumber } from '@/lib/utils';
import { useGridColumns } from '@/lib/useGridColumns';
import { useColumnVisibility } from '@/lib/useColumnVisibility';
import { useGridVirtualizer } from '@/lib/useGridVirtualizer';
import { isTauriRuntime } from '@/lib/runtime';
import {
  activeColumnFilterCount,
  applyColumnFilters,
  columnFilterUniqueValues,
  toggleColumnFilterValue,
} from '@/lib/columnFilters';
import { activeArchivedKeys } from '@/lib/triage';
import { reconcileReturns, seedDemoReturn } from './reviewReturnTracking';
import {
  compareReviewPrs,
  DEFAULT_REVIEW_STALE_THRESHOLD_DAYS,
  defaultSortDirection,
  loadMyReviewsGridViewState,
  reviewSectionOf,
  reviewTriageKey,
  reviewTriageSnapshot,
  storeMyReviewsGridViewState,
} from './myReviewsHelpers';
import {
  DEFAULT_PR_GRID_COLUMN_WIDTHS,
  DEFAULT_REVIEW_PREVIEW_WIDTH,
  FILTERABLE_COLUMNS,
  MAX_REVIEW_PREVIEW_WIDTH,
  MIN_REVIEW_PREVIEW_WIDTH,
  PR_GRID_COLUMN_MAX_WIDTHS,
  PR_GRID_COLUMN_MIN_WIDTHS,
  PR_GRID_COLUMN_WIDTHS_STORAGE_KEY,
  PR_GRID_KEYS,
  PR_GRID_OVERSCAN,
  PR_GRID_REQUIRED_COLUMNS,
  PR_GRID_ROW_HEIGHT,
  REVIEW_PREVIEW_WIDTH_STORAGE_KEY,
  REVIEW_SECTION_LABELS,
  REVIEW_SECTION_ORDER,
  type FilterableColumn,
  type MyReviewsSelectRequest,
  type ReviewRow,
  type ReviewSection,
  type SortKey,
  type SortState,
} from './myReviewsTypes';
import { useMyReviewsSelectionState } from './useMyReviewsSelectionState';

export function useMyReviewsGrid({
  selectRequest,
  onSelectRequestHandled,
}: {
  selectRequest?: MyReviewsSelectRequest | null;
  onSelectRequestHandled?: () => void;
}) {
  const initialViewState = useMemo(() => loadMyReviewsGridViewState(), []);

  // ── State ──────────────────────────────────────────────────────────────────
  // The app points at a single active connection chosen in Settings.
  const organizationId = useActiveOrganizationId();
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [snoozeAnchorRect, setSnoozeAnchorRect] = useState<DOMRect | null>(null);
  const snoozeTargetRef = useRef<ReviewPullRequestSummary | null>(null);
  const [textFilter, setTextFilter] = useState(initialViewState.textFilter);
  const [collapsedSections, setCollapsedSections] = useState<Set<ReviewSection>>(
    initialViewState.collapsedSections,
  );
  const [showDrafts, setShowDrafts] = useState(initialViewState.showDrafts);
  const [sort, setSort] = useState<SortState>(initialViewState.sort);
  const [columnFilters, setColumnFilters] = useState<
    Partial<Record<FilterableColumn, Set<string>>>
  >(initialViewState.columnFilters);
  const [openFilterCol, setOpenFilterCol] = useState<FilterableColumn | null>(null);
  const [filterAnchorRect, setFilterAnchorRect] = useState<DOMRect | null>(null);
  const filterButtonRef = useRef<HTMLElement | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [triageVersion, setTriageVersion] = useState(0);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [columnMenuRect, setColumnMenuRect] = useState<DOMRect | null>(null);
  const [previewWidth, setPreviewWidth] = useState(() =>
    storedNumber(
      REVIEW_PREVIEW_WIDTH_STORAGE_KEY,
      DEFAULT_REVIEW_PREVIEW_WIDTH,
      MIN_REVIEW_PREVIEW_WIDTH,
      MAX_REVIEW_PREVIEW_WIDTH,
    ),
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // ── Queries ────────────────────────────────────────────────────────────────
  const query = useQuery({
    queryKey: ['myReviews', organizationId],
    queryFn: () => listMyReviewPullRequests({ organizationId }),
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
  });
  const settingsQuery = useQuery({
    queryKey: ['appSettings'],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const staleThresholdDays =
    settingsQuery.data?.reviewStaleThresholdDays ?? DEFAULT_REVIEW_STALE_THRESHOLD_DAYS;
  const queryClient = useQueryClient();
  const voteMutation = useMutation({
    mutationFn: submitPullRequestVote,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['myReviews', organizationId] });
    },
  });
  const snoozeMutation = useMutation({
    mutationFn: snoozeItem,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['myReviews'] });
      void queryClient.invalidateQueries({ queryKey: ['snoozedItems', 'pull_request'] });
    },
  });

  // ── Column hooks ───────────────────────────────────────────────────────────
  const { visibleColumns, toggleColumn, resetColumns } = useColumnVisibility({
    keys: PR_GRID_KEYS,
    requiredColumns: PR_GRID_REQUIRED_COLUMNS,
    initialColumns: initialViewState.visibleColumns,
  });
  const {
    template: COLS,
    minWidth: gridMinWidth,
    resizeProps: columnResizeProps,
  } = useGridColumns({
    keys: PR_GRID_KEYS,
    visibleColumns,
    flexibleKey: 'title',
    defaults: DEFAULT_PR_GRID_COLUMN_WIDTHS,
    min: PR_GRID_COLUMN_MIN_WIDTHS,
    max: PR_GRID_COLUMN_MAX_WIDTHS,
    storageKey: PR_GRID_COLUMN_WIDTHS_STORAGE_KEY,
  });

  // ── Derived data ───────────────────────────────────────────────────────────
  const allPrs = query.data ?? [];

  const filterSuggestionPool = useMemo(() => {
    const values = new Set<string>();
    for (const pr of allPrs) {
      if (pr.repositoryName) values.add(pr.repositoryName);
      if (pr.createdBy) values.add(pr.createdBy);
    }
    return [...values];
  }, [allPrs]);

  const [returnedKeys, setReturnedKeys] = useState<Set<string>>(new Set());
  const demoSeededRef = useRef(false);
  const voteSignature = useMemo(
    () => allPrs.map((pr) => `${reviewTriageKey(pr)}:${pr.myVote}`).join('|'),
    [allPrs],
  );
  useEffect(() => {
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

  const triageScope = `myReviews:${organizationId}`;
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
      if (
        !matchesAllSearchTerms(terms, [
          pr.pullRequestId,
          pr.repositoryName,
          pr.title,
          pr.createdBy,
          pr.targetRefName,
          pr.myVoteLabel,
        ])
      )
        return false;
      return true;
    });
  }, [allPrs, archivedKeys, showDone, textFilter, showDrafts]);

  const columnUniqueValues = useMemo(
    () => columnFilterUniqueValues(baseFiltered, FILTERABLE_COLUMNS),
    [baseFiltered],
  );
  const filtered = useMemo(
    () => applyColumnFilters(baseFiltered, columnFilters, FILTERABLE_COLUMNS),
    [baseFiltered, columnFilters],
  );

  const sortedPrs = useMemo(
    () =>
      filtered
        .map((pr, index) => ({ pr, index }))
        .sort((a, b) => {
          const sectionDelta =
            REVIEW_SECTION_ORDER.indexOf(reviewSectionOf(a.pr)) -
            REVIEW_SECTION_ORDER.indexOf(reviewSectionOf(b.pr));
          if (sectionDelta !== 0) return sectionDelta;
          const result = compareReviewPrs(a.pr, b.pr, sort.key);
          const directed = sort.direction === 'asc' ? result : -result;
          return directed || a.index - b.index;
        })
        .map(({ pr }) => pr),
    [filtered, sort],
  );

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
          kind: 'header',
          key: section,
          label: REVIEW_SECTION_LABELS[section],
          count: sectionCounts.get(section) ?? 0,
        });
      }
      if (!collapsedSections.has(section)) {
        flatIndexes[prIndex] = rows.length;
        rows.push({ kind: 'pr', pr, prIndex });
      }
    });
    return { reviewRows: rows, prFlatIndexes: flatIndexes };
  }, [sortedPrs, collapsedSections]);

  // Virtualizer — must come after reviewRows is computed.
  const {
    scrollerRef,
    scrollerEl,
    firstRow: firstVirtualRow,
    lastRow: lastVirtualRow,
    topPadding: virtualTopPadding,
    bottomPadding: virtualBottomPadding,
  } = useGridVirtualizer({
    rowCount: reviewRows.length,
    rowHeight: PR_GRID_ROW_HEIGHT,
    overscan: PR_GRID_OVERSCAN,
  });

  const virtualRows = reviewRows.slice(firstVirtualRow, lastVirtualRow);

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
        .join('|'),
    [sortedPrs],
  );

  // ── Selection sub-hook ─────────────────────────────────────────────────────
  const selection = useMyReviewsSelectionState({
    sortedPrs,
    visibleSortedIndexes,
    prFlatIndexes,
    scrollerEl,
    containerRef,
    rowRefs,
    returnedKeys,
    setReturnedKeys,
    resultKeysSignature,
    organizationId,
    selectRequest,
    onSelectRequestHandled,
    onClearForSelectRequest: () => {
      setTextFilter('');
      setColumnFilters({});
      setShowDrafts(true);
      setShowDone(false);
      setShowSnoozed(false);
      setCollapsedSections(new Set());
    },
  });

  // ── Effects ────────────────────────────────────────────────────────────────
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

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      REVIEW_PREVIEW_WIDTH_STORAGE_KEY,
      String(Math.round(previewWidth)),
    );
  }, [previewWidth]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  function toggleSection(section: ReviewSection) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  function voteSelected(vote: -10 | -5 | 0 | 5 | 10, label: string) {
    const pr = sortedPrs[selection.selectedIndex];
    if (!pr || voteMutation.isPending) return;
    voteMutation.mutate(
      { ...prLocator(pr), vote },
      {
        onSuccess: () => {
          setCopyToast(`Voted: ${label}`);
          setTimeout(() => setCopyToast(null), 1500);
        },
        onError: (error) => {
          setCopyToast(`Vote failed: ${commandErrorMessage(error)}`);
          setTimeout(() => setCopyToast(null), 3000);
        },
      },
    );
  }

  function openFilter(col: FilterableColumn, anchorEl: HTMLButtonElement) {
    filterButtonRef.current = anchorEl;
    setFilterAnchorRect(anchorEl.getBoundingClientRect());
    setOpenFilterCol(col);
  }

  function toggleFilter(col: FilterableColumn, value: string) {
    const allValues = columnUniqueValues[col] ?? [];
    setColumnFilters((prev) => toggleColumnFilterValue(prev, col, value, allValues));
    selection.setSelectedIndex(0);
  }

  function clearColumnFilter(col: FilterableColumn) {
    setColumnFilters((prev) => {
      const { [col]: _, ...rest } = prev;
      return rest;
    });
    selection.setSelectedIndex(0);
  }

  function uncheckAllColumnFilter(col: FilterableColumn) {
    setColumnFilters((prev) => ({ ...prev, [col]: new Set<string>() }));
    selection.setSelectedIndex(0);
  }

  function clearAllFilters() {
    setTextFilter('');
    setColumnFilters({});
    setOpenFilterCol(null);
    setFilterAnchorRect(null);
    selection.setSelectedIndex(0);
  }

  function applySort(column: SortKey) {
    setSort((current) => {
      if (current.key !== column) {
        return { key: column, direction: defaultSortDirection(column) };
      }
      return { key: column, direction: current.direction === 'asc' ? 'desc' : 'asc' };
    });
    selection.setSelectedIndex(0);
  }

  // ── Presentation values ────────────────────────────────────────────────────
  const visiblePrs = allPrs.filter((pr) => showDrafts || !pr.isDraft);
  const noVoteCount = visiblePrs.filter((pr) => pr.myVote === 0).length;
  const columnFilterCount = activeColumnFilterCount(columnFilters);
  const activeFilterCount = (textFilter.trim() ? 1 : 0) + columnFilterCount;
  const isFiltered = activeFilterCount > 0;

  return {
    // queries
    query, queryClient, staleThresholdDays, snoozeMutation,
    // grid layout
    COLS, gridMinWidth, columnResizeProps, scrollerRef,
    virtualTopPadding, virtualBottomPadding, virtualRows,
    previewWidth, setPreviewWidth, maximized, setMaximized,
    columnMenuRect, setColumnMenuRect,
    // filter / sort state
    organizationId,
    textFilter, setTextFilter,
    showDrafts, setShowDrafts,
    sort, collapsedSections, columnFilters,
    openFilterCol, setOpenFilterCol,
    filterAnchorRect, setFilterAnchorRect,
    filterButtonRef, filterInputRef,
    showDone, setShowDone, showSnoozed, setShowSnoozed,
    // columns
    visibleColumns, toggleColumn, resetColumns,
    // data
    allPrs, sortedPrs, filterSuggestionPool, columnUniqueValues,
    returnedKeys, triageScope, triageVersion, setTriageVersion, archivedKeys, reviewRows,
    visibleSortedIndexes,
    // snooze
    snoozeTargetRef, snoozeAnchorRect, setSnoozeAnchorRect,
    // refs / toast
    containerRef, rowRefs, copyToast, setCopyToast,
    // presentation
    visiblePrs, noVoteCount, activeFilterCount, isFiltered,
    // handlers
    toggleSection, voteSelected, openFilter,
    toggleFilter, clearColumnFilter, uncheckAllColumnFilter, clearAllFilters, applySort,
    // selection (spread from sub-hook)
    ...selection,
  };
}
