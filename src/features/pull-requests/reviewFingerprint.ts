import type { ReviewPullRequestSummary } from '@/lib/azdoCommands';
import { fingerprintOf } from '@/lib/lastSeen';

/**
 * Observable PR state whose change since the last view counts as an update.
 * Excludes the user's own vote on purpose: voting is the user's action, not
 * something that happened to the PR.
 */
export function reviewFingerprint(
  pr: Pick<ReviewPullRequestSummary, 'title' | 'isDraft' | 'mergeStatus' | 'ciStatus' | 'targetRefName'>,
): string {
  return fingerprintOf(pr.title, pr.isDraft, pr.mergeStatus, pr.ciStatus, pr.targetRefName);
}
