import type { ReviewPullRequestSummary, WorkItemSummary } from '@/lib/azdoCommands';

export type OrgSummary = {
  organizationId: string;
  organizationLabel: string;
  needsMyReview: number;
  myWorkItems: number;
};

export type CrossOrgTotals = {
  needsMyReview: number;
  myWorkItems: number;
};

/**
 * A pull request is "needs my review" when I have not voted yet and it is not a
 * draft. Mirrors the sidebar badge rule in App.tsx so the two never disagree.
 */
export function needsMyReviewCount(prs: ReviewPullRequestSummary[]): number {
  return prs.filter((pr) => pr.myVote === 0 && !pr.isDraft).length;
}

export function summarizeOrganization(
  organizationId: string,
  organizationLabel: string,
  prs: ReviewPullRequestSummary[] | undefined,
  workItems: WorkItemSummary[] | undefined,
): OrgSummary {
  return {
    organizationId,
    organizationLabel,
    needsMyReview: prs ? needsMyReviewCount(prs) : 0,
    myWorkItems: workItems?.length ?? 0,
  };
}

export function totalsFor(summaries: OrgSummary[]): CrossOrgTotals {
  return summaries.reduce<CrossOrgTotals>(
    (acc, summary) => ({
      needsMyReview: acc.needsMyReview + summary.needsMyReview,
      myWorkItems: acc.myWorkItems + summary.myWorkItems,
    }),
    { needsMyReview: 0, myWorkItems: 0 },
  );
}
