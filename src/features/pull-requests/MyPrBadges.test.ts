import { describe, expect, it } from "vitest";
import type { MyCreatedPullRequestSummary } from "@/lib/azdoCommands";
import { isReadyToMerge } from "./MyPrBadges";

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

  it("is not ready while CI fails, runs, or a required policy is unmet", () => {
    const health = { ciStatus: "succeeded", ciContext: null, ciCheckCount: 1, unresolvedThreads: 0 };
    expect(isReadyToMerge(base, health, [])).toBe(true);
    expect(isReadyToMerge(base, { ...health, ciStatus: "failed" }, [])).toBe(false);
    expect(isReadyToMerge(base, { ...health, ciStatus: "in_progress" }, [])).toBe(false);
    const unmet = { name: "Build", status: "rejected", isBlocking: true, detail: null };
    expect(isReadyToMerge(base, health, [unmet])).toBe(false);
    expect(isReadyToMerge(base, health, [{ ...unmet, isBlocking: false }])).toBe(true);
  });
});
