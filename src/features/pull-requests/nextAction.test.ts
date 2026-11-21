import { describe, expect, it } from 'vitest';
import {
  createdNextAction,
  nextActionableIndex,
  reviewNextAction,
  type NextAction,
} from './nextAction';

const base = { isDraft: false, mergeStatus: null, ciStatus: null, myVote: 0 };

describe('reviewNextAction', () => {
  it('prioritises draft, then conflicts, then CI, then vote', () => {
    expect(reviewNextAction({ ...base, isDraft: true, mergeStatus: 'conflicts' })).toBe('draft');
    expect(reviewNextAction({ ...base, mergeStatus: 'conflicts', ciStatus: 'failed' })).toBe('conflict');
    expect(reviewNextAction({ ...base, ciStatus: 'failed' })).toBe('ciFailed');
    expect(reviewNextAction(base)).toBe('needsMe');
  });

  it('treats non-approving votes as waiting on the author', () => {
    expect(reviewNextAction({ ...base, myVote: 5 })).toBe('waitingAuthor');
    expect(reviewNextAction({ ...base, myVote: -5 })).toBe('waitingAuthor');
    expect(reviewNextAction({ ...base, myVote: -10 })).toBe('waitingAuthor');
    expect(reviewNextAction({ ...base, myVote: 10 })).toBe('done');
  });
});

describe('createdNextAction', () => {
  it('maps draft, ready and pending PRs', () => {
    expect(createdNextAction({ isDraft: true, readyToMerge: true })).toBe('draft');
    expect(createdNextAction({ isDraft: false, readyToMerge: true })).toBe('readyToMerge');
    expect(createdNextAction({ isDraft: false, readyToMerge: false })).toBe('waitingReviewers');
  });
});

describe('nextActionableIndex', () => {
  const actions: NextAction[] = ['done', 'needsMe', 'waitingAuthor', 'ciFailed', 'draft'];

  it('moves forward and backward, wrapping around', () => {
    expect(nextActionableIndex(actions, 0, 1)).toBe(1);
    expect(nextActionableIndex(actions, 1, 1)).toBe(3);
    expect(nextActionableIndex(actions, 3, 1)).toBe(1);
    expect(nextActionableIndex(actions, 1, -1)).toBe(3);
  });

  it('returns -1 when nothing is actionable', () => {
    expect(nextActionableIndex(['done', 'draft'], 0, 1)).toBe(-1);
    expect(nextActionableIndex([], 0, 1)).toBe(-1);
  });
});
