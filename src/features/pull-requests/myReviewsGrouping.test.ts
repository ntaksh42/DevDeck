import { describe, expect, it } from "vitest";
import type { ReviewPullRequestSummary } from "@/lib/azdoCommands";
import { buildReviewRows, compareReviewGroups } from "./myReviewsGrouping";

function pr(id: number, repositoryName: string, myVote = 0): ReviewPullRequestSummary {
  return {
    pullRequestId: id,
    title: `PR ${id}`,
    repositoryId: `repo-${repositoryName}`,
    repositoryName,
    myVote,
    isDraft: false,
  } as unknown as ReviewPullRequestSummary;
}

function sortByGroup(prs: ReviewPullRequestSummary[], groupBy: "status" | "repository") {
  return [...prs].sort((a, b) => compareReviewGroups(a, b, groupBy));
}

describe("buildReviewRows", () => {
  const prs = [pr(1, "web", 10), pr(2, "api"), pr(3, "web"), pr(4, "Api", 10)];

  it("groups by repository name A to Z with one header per repository", () => {
    const { reviewRows } = buildReviewRows(sortByGroup(prs, "repository"), "repository", new Set());
    const headers = reviewRows.filter((row) => row.kind === "header");
    expect(headers.map((row) => [row.label, row.count])).toEqual([
      ["api", 1],
      ["Api", 1],
      ["web", 2],
    ]);
  });

  it("keeps status grouping as before", () => {
    const { reviewRows } = buildReviewRows(sortByGroup(prs, "status"), "status", new Set());
    const headers = reviewRows.filter((row) => row.kind === "header");
    expect(headers.map((row) => [row.label, row.count])).toEqual([
      ["Needs your review", 2],
      ["Approved by you", 2],
    ]);
  });

  it("hides a collapsed repository's PRs and previews them in the header", () => {
    const sorted = sortByGroup(prs, "repository");
    const { reviewRows, prFlatIndexes } = buildReviewRows(sorted, "repository", new Set(["repo-web"]));
    const web = reviewRows.find((row) => row.kind === "header" && row.key === "repo-web");
    expect(web).toMatchObject({ preview: "#1 PR 1 · #3 PR 3" });
    expect(reviewRows.some((row) => row.kind === "pr" && row.pr.repositoryName === "web")).toBe(false);
    expect(prFlatIndexes[sorted.findIndex((p) => p.pullRequestId === 1)]).toBeUndefined();
  });
});
