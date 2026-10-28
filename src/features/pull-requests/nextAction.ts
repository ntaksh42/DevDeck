// "Next action" classification for pull requests: collapses vote, CI, merge
// and draft state into the single thing the user should do (or wait for).
// Pure functions only, so My Reviews and My Pull Requests share one rule set.

import type {
  MyCreatedPullRequestSummary,
  ReviewPullRequestSummary,
} from '@/lib/azdoCommands';

export type NextAction =
  | 'needsMe'
  | 'waitingAuthor'
  | 'ciFailed'
  | 'conflict'
  | 'readyToMerge'
  | 'waitingReviewers'
  | 'draft'
  | 'done';

export const NEXT_ACTION_LABELS: Record<NextAction, string> = {
  needsMe: 'Needs you',
  waitingAuthor: 'Waiting for author',
  ciFailed: 'CI failed',
  conflict: 'Conflicts',
  readyToMerge: 'Ready to merge',
  waitingReviewers: 'Waiting for reviewers',
  draft: 'Draft',
  done: 'Done',
};

// Actions where the user themselves has something to do.
const ACTIONABLE: ReadonlySet<NextAction> = new Set([
  'needsMe',
  'conflict',
  'ciFailed',
  'readyToMerge',
]);

export function isActionable(action: NextAction): boolean {
  return ACTIONABLE.has(action);
}

export function reviewNextAction(
  pr: Pick<ReviewPullRequestSummary, 'isDraft' | 'mergeStatus' | 'ciStatus' | 'myVote'>,
): NextAction {
  if (pr.isDraft) return 'draft';
  if (pr.mergeStatus === 'conflicts') return 'conflict';
  if (pr.ciStatus === 'failed') return 'ciFailed';
  if (pr.myVote === 0) return 'needsMe';
  if (pr.myVote < 10) return 'waitingAuthor';
  return 'done';
}

export function createdNextAction(
  pr: Pick<MyCreatedPullRequestSummary, 'isDraft' | 'readyToMerge'>,
): NextAction {
  if (pr.isDraft) return 'draft';
  if (pr.readyToMerge) return 'readyToMerge';
  return 'waitingReviewers';
}

/**
 * Index of the next (or previous) actionable row after `from`, wrapping
 * around the list. Returns -1 when no row needs the user.
 */
export function nextActionableIndex(
  actions: readonly NextAction[],
  from: number,
  direction: 1 | -1,
): number {
  const count = actions.length;
  for (let step = 1; step <= count; step += 1) {
    const index = (((from + direction * step) % count) + count) % count;
    if (isActionable(actions[index])) return index;
  }
  return -1;
}
