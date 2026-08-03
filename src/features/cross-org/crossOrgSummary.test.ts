import { describe, expect, it } from "vitest";
import type { ReviewPullRequestSummary, WorkItemSummary } from "@/lib/azdoCommands";
import {
  needsMyReviewCount,
  summarizeOrganization,
  totalsFor,
} from "./crossOrgSummary";

function pr(overrides: Partial<ReviewPullRequestSummary>): ReviewPullRequestSummary {
  return { myVote: 0, isDraft: false, ...overrides } as ReviewPullRequestSummary;
}

function workItem(id: number): WorkItemSummary {
  return { id } as WorkItemSummary;
}

describe("crossOrgSummary", () => {
  it("counts only unvoted non-draft pull requests", () => {
    expect(
      needsMyReviewCount([
        pr({ myVote: 0 }),
        pr({ myVote: 10 }), // already approved
        pr({ myVote: 0, isDraft: true }), // draft
        pr({ myVote: -5 }), // waiting
        pr({ myVote: 0 }),
      ]),
    ).toBe(2);
  });

  it("summarizes one organization", () => {
    const summary = summarizeOrganization(
      "contoso",
      "Contoso",
      [pr({ myVote: 0 }), pr({ myVote: 10 })],
      [workItem(1), workItem(2), workItem(3)],
    );
    expect(summary).toEqual({
      organizationId: "contoso",
      organizationLabel: "Contoso",
      needsMyReview: 1,
      myWorkItems: 3,
    });
  });

  // Queries are still loading on first render, so undefined must read as zero
  // rather than blanking the totals.
  it("treats missing query data as zero", () => {
    const summary = summarizeOrganization("a", "A", undefined, undefined);
    expect(summary.needsMyReview).toBe(0);
    expect(summary.myWorkItems).toBe(0);
  });

  it("totals across organizations", () => {
    const totals = totalsFor([
      summarizeOrganization("a", "A", [pr({ myVote: 0 })], [workItem(1)]),
      summarizeOrganization(
        "b",
        "B",
        [pr({ myVote: 0 }), pr({ myVote: 0 })],
        [workItem(2), workItem(3)],
      ),
    ]);
    expect(totals).toEqual({ needsMyReview: 3, myWorkItems: 3 });
  });

  // The spec requires the view to work as a single-organization summary too.
  it("works with a single organization", () => {
    const totals = totalsFor([
      summarizeOrganization("solo", "Solo", [pr({ myVote: 0 })], [workItem(1)]),
    ]);
    expect(totals).toEqual({ needsMyReview: 1, myWorkItems: 1 });
  });

  it("totals to zero when there are no connections", () => {
    expect(totalsFor([])).toEqual({ needsMyReview: 0, myWorkItems: 0 });
  });
});
