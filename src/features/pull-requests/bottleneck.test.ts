import { describe, expect, it } from "vitest";
import type { ReviewPullRequestSummary } from "@/lib/azdoCommands";
import {
  bottleneckBucketsOf,
  type BottleneckBucket,
} from "./MyReviewsGrid";

function reviewPr(overrides: Partial<ReviewPullRequestSummary>): ReviewPullRequestSummary {
  return {
    organizationId: "contoso",
    projectId: "p",
    projectName: "P",
    repositoryId: "r",
    repositoryName: "R",
    pullRequestId: 1,
    title: "PR",
    createdBy: "Author",
    creationDate: "2026-06-01T00:00:00Z",
    targetRefName: "main",
    webUrl: null,
    myVote: 0,
    myVoteLabel: "No Vote",
    myIsRequired: false,
    isDraft: false,
    mergeStatus: null,
    ciStatus: null,
    ciContext: null,
    ciCheckCount: 0,
    ...overrides,
  };
}

function buckets(pr: ReviewPullRequestSummary): BottleneckBucket[] {
  return [...bottleneckBucketsOf(pr)];
}

describe("bottleneckBucketsOf", () => {
  it("counts an un-voted PR as waiting on me", () => {
    expect(buckets(reviewPr({ myVote: 0 }))).toEqual(["waitingMe"]);
  });

  it("counts waiting/rejected votes as waiting on author", () => {
    expect(buckets(reviewPr({ myVote: -5 }))).toEqual(["waitingAuthor"]);
    expect(buckets(reviewPr({ myVote: -10 }))).toEqual(["waitingAuthor"]);
  });

  it("counts an in-progress CI as waiting on CI regardless of vote", () => {
    expect(buckets(reviewPr({ myVote: 5, ciStatus: "in_progress" }))).toEqual([
      "waitingCi",
    ]);
  });

  it("marks an approved, green, conflict-free PR as ready to merge", () => {
    expect(
      buckets(reviewPr({ myVote: 10, ciStatus: "succeeded", mergeStatus: null })),
    ).toEqual(["readyToMerge"]);
  });

  it("does not mark an approved PR with conflicts as ready to merge", () => {
    expect(
      buckets(reviewPr({ myVote: 10, ciStatus: "succeeded", mergeStatus: "conflicts" })),
    ).toEqual([]);
  });

  it("excludes drafts from every bucket", () => {
    expect(buckets(reviewPr({ myVote: 0, isDraft: true }))).toEqual([]);
  });
});
