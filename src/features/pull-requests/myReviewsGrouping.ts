import type { ReviewPullRequestSummary } from '@/lib/azdoCommands';
import { reviewSectionOf, sectionPreview } from './myReviewsHelpers';
import {
  REVIEW_SECTION_LABELS,
  REVIEW_SECTION_ORDER,
  type ReviewGroupBy,
  type ReviewRow,
  type ReviewSection,
} from './myReviewsTypes';

/** Status mode keys rows by review section; repository mode by repositoryId. */
export function reviewGroupKeyOf(pr: ReviewPullRequestSummary, groupBy: ReviewGroupBy): string {
  return groupBy === 'repository' ? pr.repositoryId : reviewSectionOf(pr);
}

/** Orders groups: fixed section order, or repository name A→Z. */
export function compareReviewGroups(
  a: ReviewPullRequestSummary,
  b: ReviewPullRequestSummary,
  groupBy: ReviewGroupBy,
): number {
  if (groupBy === 'repository') {
    return (
      a.repositoryName.localeCompare(b.repositoryName, undefined, { sensitivity: 'base' }) ||
      a.repositoryId.localeCompare(b.repositoryId)
    );
  }
  return (
    REVIEW_SECTION_ORDER.indexOf(reviewSectionOf(a)) -
    REVIEW_SECTION_ORDER.indexOf(reviewSectionOf(b))
  );
}

/**
 * Turns group-sorted PRs into header + PR rows. Collapsed groups keep their
 * header only; `prFlatIndexes[prIndex]` maps a PR to its row (unset if hidden).
 */
export function buildReviewRows(
  sortedPrs: readonly ReviewPullRequestSummary[],
  groupBy: ReviewGroupBy,
  collapsed: ReadonlySet<string>,
): { reviewRows: ReviewRow[]; prFlatIndexes: number[] } {
  const groupPrs = new Map<string, ReviewPullRequestSummary[]>();
  for (const pr of sortedPrs) {
    const key = reviewGroupKeyOf(pr, groupBy);
    const list = groupPrs.get(key);
    if (list) list.push(pr);
    else groupPrs.set(key, [pr]);
  }
  const reviewRows: ReviewRow[] = [];
  const prFlatIndexes: number[] = [];
  let currentKey: string | null = null;
  sortedPrs.forEach((pr, prIndex) => {
    const key = reviewGroupKeyOf(pr, groupBy);
    if (key !== currentKey) {
      currentKey = key;
      const prs = groupPrs.get(key) ?? [];
      reviewRows.push({
        kind: 'header',
        key,
        label:
          groupBy === 'repository'
            ? pr.repositoryName
            : REVIEW_SECTION_LABELS[key as ReviewSection],
        count: prs.length,
        preview: collapsed.has(key) ? sectionPreview(prs) : '',
      });
    }
    if (!collapsed.has(key)) {
      prFlatIndexes[prIndex] = reviewRows.length;
      reviewRows.push({ kind: 'pr', pr, prIndex });
    }
  });
  return { reviewRows, prFlatIndexes };
}
