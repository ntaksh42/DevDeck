import { describe, expect, it } from "vitest";
import {
  MAX_REVIEW_ROWS,
  MAX_WORK_ITEM_ROWS,
  selectTodayReviews,
  selectTodayWorkItems,
} from "./TodayView";
import type {
  ReviewPullRequestSummary,
  WorkItemSummary,
} from "@/lib/azdoCommands";

function pr(overrides: Partial<ReviewPullRequestSummary>): ReviewPullRequestSummary {
  return {
    organizationId: "org",
    projectId: "proj",
    projectName: "Proj",
    repositoryId: "repo",
    repositoryName: "repo",
    pullRequestId: 1,
    title: "PR",
    createdBy: "Author",
    creationDate: "2026-06-01T00:00:00Z",
    targetRefName: "main",
    webUrl: null,
    myVote: 0,
    myVoteLabel: "No Vote",
    myIsRequired: true,
    isDraft: false,
    mergeStatus: null,
    ciStatus: null,
    ciContext: null,
    ciCheckCount: 0,
    ...overrides,
  };
}

function wi(overrides: Partial<WorkItemSummary>): WorkItemSummary {
  return {
    organizationId: "org",
    projectId: "proj",
    projectName: "Proj",
    id: 1,
    title: "WI",
    workItemType: "Task",
    state: "Active",
    assignedTo: "Me",
    changedDate: "2026-06-01T00:00:00Z",
    webUrl: null,
    extraFields: [],
    depth: null,
    ...overrides,
  };
}

describe("selectTodayReviews", () => {
  it("keeps only required, unvoted, non-draft pull requests", () => {
    const result = selectTodayReviews([
      pr({ pullRequestId: 1, myIsRequired: true, myVote: 0, isDraft: false }),
      pr({ pullRequestId: 2, myIsRequired: false, myVote: 0 }),
      pr({ pullRequestId: 3, myIsRequired: true, myVote: 10 }),
      pr({ pullRequestId: 4, myIsRequired: true, myVote: 0, isDraft: true }),
    ]);
    expect(result.map((item) => item.pullRequestId)).toEqual([1]);
  });

  it("sorts oldest first and caps the count", () => {
    const many = Array.from({ length: MAX_REVIEW_ROWS + 5 }, (_, i) =>
      pr({
        pullRequestId: i + 1,
        creationDate: new Date(2026, 0, i + 1).toISOString(),
      }),
    );
    const result = selectTodayReviews(many);
    expect(result).toHaveLength(MAX_REVIEW_ROWS);
    expect(result[0].pullRequestId).toBe(1);
  });
});

describe("selectTodayWorkItems", () => {
  it("keeps only active-state items", () => {
    const result = selectTodayWorkItems([
      wi({ id: 1, state: "Active" }),
      wi({ id: 2, state: "New" }),
      wi({ id: 3, state: "Doing" }),
      wi({ id: 4, state: "Closed" }),
    ]);
    expect(result.map((item) => item.id).sort()).toEqual([1, 3]);
  });

  it("sorts most recently changed first and caps the count", () => {
    const many = Array.from({ length: MAX_WORK_ITEM_ROWS + 5 }, (_, i) =>
      wi({
        id: i + 1,
        state: "Active",
        changedDate: new Date(2026, 0, i + 1).toISOString(),
      }),
    );
    const result = selectTodayWorkItems(many);
    expect(result).toHaveLength(MAX_WORK_ITEM_ROWS);
    // Newest (highest index) should be first.
    expect(result[0].id).toBe(MAX_WORK_ITEM_ROWS + 5);
  });
});
