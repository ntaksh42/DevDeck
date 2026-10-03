import { describe, expect, it } from "vitest";
import type { MyCreatedPullRequestSummary, ReviewPullRequestSummary } from "@/lib/azdoCommands";
import { rowsToTsv } from "@/lib/clipboardTable";
import { createdCopyColumns, reviewCopyColumns } from "./prCopyColumns";

const created = {
  pullRequestId: 77,
  title: "Add toggle",
  repositoryName: "azdo",
  creationDate: "not-a-date",
  targetRefName: "refs/heads/main",
  webUrl: "https://dev.azure.com/o/p/_git/r/pullrequest/77",
  isDraft: true,
  approvals: 1,
  reviewerCount: 2,
} as MyCreatedPullRequestSummary;

describe("createdCopyColumns", () => {
  it("follows the visible columns and marks drafts", () => {
    const cols = createdCopyColumns(["pullRequestId", "title", "approvals"]);
    expect(rowsToTsv([created], cols)).toBe(
      "PR#\tTitle\tApprovals\n#77\t[Draft] Add toggle\t1/2",
    );
  });

  it("links the ID and title cells only", () => {
    const cols = createdCopyColumns(["pullRequestId", "repositoryName", "title"]);
    expect(cols.map((c) => Boolean(c.href))).toEqual([true, false, true]);
  });
});

describe("reviewCopyColumns", () => {
  const review = {
    ...created,
    createdBy: null,
    isDraft: false,
    myIsRequired: true,
    myVoteLabel: "Approved",
    ciStatus: "in_progress",
  } as unknown as ReviewPullRequestSummary;

  it("renders CI, role and vote as labels instead of icons", () => {
    const cols = reviewCopyColumns(["ciStatus", "createdBy", "myIsRequired", "myVote"]);
    expect(rowsToTsv([review], cols)).toBe(
      "CI\tAuthor\tRole\tMy Vote\nIn progress\tUnknown\tRequired\tApproved",
    );
  });
});
