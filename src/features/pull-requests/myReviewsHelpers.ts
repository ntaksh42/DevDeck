import { DEFAULT_REVIEW_STALE_THRESHOLD_DAYS, type ReviewPullRequestSummary } from '@/lib/azdoCommands';
import { normalizeVisibleColumns } from '@/lib/useColumnVisibility';
import type { SortDirection } from '@/lib/utils';
import {
  DEFAULT_COLLAPSED_SECTIONS,
  FILTERABLE_COLUMNS,
  PR_GRID_KEYS,
  PR_GRID_REQUIRED_COLUMNS,
  PR_GRID_VIEW_STORAGE_KEY,
  REVIEW_SECTION_ORDER,
  sortLabels,
  type FilterableColumn,
  type MyReviewsGridViewState,
  type ReviewSection,
  type SortKey,
} from './myReviewsTypes';

export function reviewSectionOf(pr: ReviewPullRequestSummary): ReviewSection {
  if (pr.isDraft) return 'draft';
  if (pr.myVote === 10 || pr.myVote === 5) return 'approved';
  if (pr.myVote === -5) return 'waitingAuthor';
  if (pr.myVote === -10) return 'rejected';
  return 'needsReview';
}

export function reviewTriageKey(pr: ReviewPullRequestSummary): string {
  return `${pr.repositoryId}:${pr.pullRequestId}`;
}

export function reviewTriageSnapshot(pr: ReviewPullRequestSummary): string {
  return `${pr.myVote}|${pr.isDraft}|${pr.title}|${pr.creationDate}`;
}

export function reviewAgeDays(
  creationDate: string,
  now: number = Date.now(),
): number | null {
  const created = new Date(creationDate).getTime();
  if (!Number.isFinite(created)) return null;
  return Math.max(0, Math.floor((now - created) / 86_400_000));
}

export function defaultSortDirection(key: SortKey): SortDirection {
  return key === 'creationDate' || key === 'reviewAge' ? 'desc' : 'asc';
}

function compareStrings(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  return (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' });
}

function ciSortRank(status: string | null): number {
  switch (status) {
    case 'failed':
      return 0;
    case 'in_progress':
      return 1;
    case 'succeeded':
      return 2;
    default:
      return 3;
  }
}

export function compareReviewPrs(
  a: ReviewPullRequestSummary,
  b: ReviewPullRequestSummary,
  key: SortKey,
): number {
  switch (key) {
    case 'pullRequestId':
      return a.pullRequestId - b.pullRequestId;
    case 'ciStatus':
      return ciSortRank(a.ciStatus) - ciSortRank(b.ciStatus);
    case 'repositoryName':
      return compareStrings(a.repositoryName, b.repositoryName);
    case 'title':
      return compareStrings(a.title, b.title);
    case 'createdBy':
      return compareStrings(a.createdBy, b.createdBy);
    case 'creationDate': {
      const left = new Date(a.creationDate).getTime();
      const right = new Date(b.creationDate).getTime();
      if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
      if (Number.isFinite(left)) return -1;
      if (Number.isFinite(right)) return 1;
      return compareStrings(a.creationDate, b.creationDate);
    }
    case 'reviewAge': {
      const left = new Date(a.creationDate).getTime();
      const right = new Date(b.creationDate).getTime();
      if (Number.isFinite(left) && Number.isFinite(right)) return right - left;
      if (Number.isFinite(left)) return -1;
      if (Number.isFinite(right)) return 1;
      return compareStrings(b.creationDate, a.creationDate);
    }
    case 'targetRefName':
      return compareStrings(a.targetRefName, b.targetRefName);
    case 'myIsRequired':
      return Number(a.myIsRequired) - Number(b.myIsRequired);
    case 'myVote':
      return a.myVote - b.myVote;
  }
}

export function defaultMyReviewsGridViewState(): MyReviewsGridViewState {
  return {
    collapsedSections: new Set(DEFAULT_COLLAPSED_SECTIONS),
    columnFilters: {},
    organizationId: '',
    showDrafts: false,
    sort: { key: 'creationDate', direction: 'desc' },
    visibleColumns: [...PR_GRID_KEYS],
  };
}

export function loadMyReviewsGridViewState(): MyReviewsGridViewState {
  const fallback = defaultMyReviewsGridViewState();
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(PR_GRID_VIEW_STORAGE_KEY) ?? 'null',
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    const sort =
      parsed.sort &&
      Object.keys(sortLabels).includes(parsed.sort.key) &&
      (parsed.sort.direction === 'asc' || parsed.sort.direction === 'desc')
        ? {
            key: parsed.sort.key as SortKey,
            direction: parsed.sort.direction as SortDirection,
          }
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
    if (
      parsedFilters &&
      typeof parsedFilters === 'object' &&
      !Array.isArray(parsedFilters)
    ) {
      for (const column of Object.keys(FILTERABLE_COLUMNS) as FilterableColumn[]) {
        const values = parsedFilters[column];
        if (Array.isArray(values)) {
          const cleaned = values.filter(
            (value): value is string => typeof value === 'string',
          );
          columnFilters[column] = new Set(cleaned);
        }
      }
    }
    return {
      collapsedSections,
      columnFilters,
      organizationId:
        typeof parsed.organizationId === 'string' ? parsed.organizationId : '',
      showDrafts:
        typeof parsed.showDrafts === 'boolean' ? parsed.showDrafts : fallback.showDrafts,
      sort,
      visibleColumns: normalizeVisibleColumns(
        PR_GRID_KEYS,
        PR_GRID_REQUIRED_COLUMNS,
        parsed.visibleColumns,
      ),
    };
  } catch {
    return fallback;
  }
}

export function storeMyReviewsGridViewState(state: MyReviewsGridViewState) {
  const columnFilters: Partial<Record<FilterableColumn, string[]>> = {};
  for (const column of Object.keys(FILTERABLE_COLUMNS) as FilterableColumn[]) {
    const values = state.columnFilters[column];
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

export { DEFAULT_REVIEW_STALE_THRESHOLD_DAYS };
