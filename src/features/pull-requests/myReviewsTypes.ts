import type { Organization, ReviewPullRequestSummary } from '@/lib/azdoCommands';
import type { SortDirection } from '@/lib/utils';

export type { Organization, ReviewPullRequestSummary };

// ── Layout constants ────────────────────────────────────────────────────────
export const DEFAULT_REVIEW_PREVIEW_WIDTH = 420;
export const MIN_REVIEW_PREVIEW_WIDTH = 280;
export const MAX_REVIEW_PREVIEW_WIDTH = 8192;
export const REVIEW_PREVIEW_WIDTH_STORAGE_KEY = 'azdodeck:layout:reviewPreviewWidth';
export const DEFAULT_PR_GRID_COLUMN_WIDTHS = [52, 36, 110, 180, 82, 56, 64, 76, 68, 78];
export const PR_GRID_COLUMN_MIN_WIDTHS = [48, 32, 96, 150, 72, 50, 52, 68, 62, 70];
export const PR_GRID_COLUMN_MAX_WIDTHS = [120, 60, 520, 960, 240, 120, 120, 240, 180, 240];
export const PR_GRID_COLUMN_WIDTHS_STORAGE_KEY =
  'azdodeck:layout:myReviewsGridColumnWidths:v4';
export const PR_GRID_VIEW_STORAGE_KEY = 'azdodeck:view:myReviewsGrid:v1';
export const PR_GRID_ROW_HEIGHT = 29;
export const PR_GRID_OVERSCAN = 8;

// ── Vote ────────────────────────────────────────────────────────────────────
export type VoteValue = -10 | -5 | 0 | 5 | 10 | number;

// ── Section model ───────────────────────────────────────────────────────────
export type ReviewSection =
  | 'needsReview'
  | 'waitingAuthor'
  | 'approved'
  | 'rejected'
  | 'draft';

export const REVIEW_SECTION_ORDER: ReviewSection[] = [
  'needsReview',
  'waitingAuthor',
  'approved',
  'rejected',
  'draft',
];

export const REVIEW_SECTION_LABELS: Record<ReviewSection, string> = {
  needsReview: 'Needs your review',
  waitingAuthor: 'Waiting for author',
  approved: 'Approved by you',
  rejected: 'Rejected by you',
  draft: 'Drafts',
};

export type ReviewRow =
  | { kind: 'header'; key: ReviewSection; label: string; count: number }
  | { kind: 'pr'; pr: ReviewPullRequestSummary; prIndex: number };

// ── Sort ────────────────────────────────────────────────────────────────────
export type SortKey =
  | 'pullRequestId'
  | 'ciStatus'
  | 'repositoryName'
  | 'title'
  | 'createdBy'
  | 'creationDate'
  | 'reviewAge'
  | 'targetRefName'
  | 'myIsRequired'
  | 'myVote';

export type SortState = { key: SortKey; direction: SortDirection };

export const sortLabels: Record<SortKey, string> = {
  pullRequestId: 'PR#',
  ciStatus: 'CI',
  repositoryName: 'Repository',
  title: 'Title',
  createdBy: 'Author',
  creationDate: 'Created',
  reviewAge: 'Review age',
  targetRefName: 'Target',
  myIsRequired: 'Role',
  myVote: 'My Vote',
};

export const PR_GRID_KEYS: SortKey[] = [
  'pullRequestId',
  'ciStatus',
  'repositoryName',
  'title',
  'createdBy',
  'creationDate',
  'reviewAge',
  'targetRefName',
  'myIsRequired',
  'myVote',
];

export const PR_GRID_REQUIRED_COLUMNS: SortKey[] = ['pullRequestId', 'title'];

// ── Column filters ──────────────────────────────────────────────────────────
export type FilterableColumn =
  | 'repositoryName'
  | 'createdBy'
  | 'targetRefName'
  | 'myIsRequired'
  | 'myVote';

export const FILTERABLE_COLUMNS: Record<
  FilterableColumn,
  (pr: ReviewPullRequestSummary) => string
> = {
  repositoryName: (pr) => pr.repositoryName,
  createdBy: (pr) => pr.createdBy ?? 'Unknown',
  targetRefName: (pr) => pr.targetRefName,
  myIsRequired: (pr) => (pr.myIsRequired ? 'Required' : 'Optional'),
  myVote: (pr) => pr.myVoteLabel,
};

export function isFilterableColumn(column: SortKey): column is FilterableColumn {
  return column in FILTERABLE_COLUMNS;
}

// ── View state ──────────────────────────────────────────────────────────────
export type MyReviewsGridViewState = {
  collapsedSections: Set<ReviewSection>;
  columnFilters: Partial<Record<FilterableColumn, Set<string>>>;
  organizationId: string;
  showDrafts: boolean;
  sort: SortState;
  textFilter: string;
  visibleColumns: SortKey[];
};

export const DEFAULT_COLLAPSED_SECTIONS: ReviewSection[] = [
  'waitingAuthor',
  'approved',
  'rejected',
  'draft',
];

// ── Public API types ────────────────────────────────────────────────────────
export type MyReviewsSelectRequest = {
  pullRequestId: number;
  repositoryId: string | null;
  organizationId?: string;
  requestId: number;
};

export type MyReviewsGridProps = {
  organizations: Organization[];
  selectRequest?: MyReviewsSelectRequest | null;
  onSelectRequestHandled?: () => void;
};
