import { describe, expect, it } from "vitest";
import type { MyCreatedPullRequestSummary } from "@/lib/azdoCommands";
import { isReadyToMerge } from "./MyPullRequestsRow";

const base = {
  isDraft: false,
  mergeStatus: null,
  approvals: 2,
  reviewerCount: 2,
} as MyCreatedPullRequestSummary;

describe("isReadyToMerge", () => {
  it("needs every reviewer to approve", () => {
    expect(isReadyToMerge(base)).toBe(true);
    expect(isReadyToMerge({ ...base, approvals: 1 })).toBe(false);
  });
  it("is false for drafts, conflicts, and PRs without reviewers", () => {
    expect(isReadyToMerge({ ...base, isDraft: true })).toBe(false);
    expect(isReadyToMerge({ ...base, mergeStatus: "conflicts" })).toBe(false);
    expect(isReadyToMerge({ ...base, approvals: 0, reviewerCount: 0 })).toBe(false);
  });
});
