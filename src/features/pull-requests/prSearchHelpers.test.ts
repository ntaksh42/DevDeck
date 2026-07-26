import { describe, expect, it } from "vitest";
import type { PullRequestSummary } from "@/lib/azdoCommands";
import { reviewTriageKey } from "./myReviewsHelpers";
import { toReviewSummary } from "./PrSearchTypes";

function searchResult(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    organizationId: "org-a",
    projectId: "proj-1",
    projectName: "Proj",
    repositoryId: "repo-1",
    repositoryName: "Repo",
    pullRequestId: 42,
    title: "Add widget",
    status: "active",
    createdBy: "Ada",
    creationDate: "2026-06-20T10:00:00Z",
    closedDate: null,
    sourceRefName: "refs/heads/feature",
    targetRefName: "refs/heads/main",
    webUrl: "https://dev.azure.com/org-a/Proj/_git/Repo/pullrequest/42",
    isDraft: false,
    ...overrides,
  };
}

describe("toReviewSummary", () => {
  it("preserves the draft flag from the search result", () => {
    const summary = toReviewSummary(searchResult({ isDraft: true }));
    expect(summary.isDraft).toBe(true);
  });

  it("keeps a non-draft pull request non-draft", () => {
    const summary = toReviewSummary(searchResult({ isDraft: false }));
    expect(summary.isDraft).toBe(false);
  });

  it("defaults the vote fields the search shape does not carry", () => {
    const summary = toReviewSummary(searchResult());
    expect(summary.myVote).toBe(0);
    expect(summary.myVoteLabel).toBe("No Vote");
    expect(summary.myIsRequired).toBe(false);
  });
});

describe("reviewTriageKey", () => {
  it("distinguishes the same repository id across organizations", () => {
    const inOrgA = toReviewSummary(searchResult({ organizationId: "org-a" }));
    const inOrgB = toReviewSummary(searchResult({ organizationId: "org-b" }));
    expect(reviewTriageKey(inOrgA)).not.toBe(reviewTriageKey(inOrgB));
  });

  it("is stable for the same pull request", () => {
    const pr = toReviewSummary(searchResult());
    expect(reviewTriageKey(pr)).toBe(reviewTriageKey(toReviewSummary(searchResult())));
  });

  it("distinguishes pull requests within one repository", () => {
    const first = toReviewSummary(searchResult({ pullRequestId: 1 }));
    const second = toReviewSummary(searchResult({ pullRequestId: 2 }));
    expect(reviewTriageKey(first)).not.toBe(reviewTriageKey(second));
  });
});
