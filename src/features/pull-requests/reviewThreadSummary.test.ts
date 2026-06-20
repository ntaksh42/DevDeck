import { describe, expect, it } from "vitest";
import type { PullRequestReview } from "@/lib/azdoCommands";
import { summarizeThreads } from "./reviewThreadSummary";

function review(threads: PullRequestReview["threads"]): PullRequestReview {
  return {
    pullRequestId: 1,
    title: "PR",
    description: null,
    sourceRefName: "feature/x",
    targetRefName: "main",
    createdBy: "Author",
    creationDate: null,
    isDraft: false,
    reviewers: [],
    threads,
  };
}

function thread(
  overrides: Partial<PullRequestReview["threads"][number]>,
): PullRequestReview["threads"][number] {
  return {
    id: 1,
    status: "active",
    isResolved: false,
    comments: [],
    ...overrides,
  } as PullRequestReview["threads"][number];
}

function comment(content: string | null, author: string | null, isSystem = false) {
  return {
    id: 1,
    parentCommentId: 0,
    content,
    author,
    publishedDate: null,
    isSystem,
    isMine: false,
  } as PullRequestReview["threads"][number]["comments"][number];
}

describe("summarizeThreads", () => {
  it("returns zeros for no review", () => {
    expect(summarizeThreads(undefined, "user-1")).toEqual({
      unresolved: 0,
      mentionsMe: false,
      lastCommenter: null,
    });
  });

  it("counts only unresolved threads that have comments", () => {
    const r = review([
      thread({ isResolved: false, comments: [comment("hi", "Alice")] }),
      thread({ isResolved: true, comments: [comment("done", "Bob")] }),
      thread({ isResolved: false, comments: [] }), // system thread, ignored
    ]);
    const summary = summarizeThreads(r, "user-1");
    expect(summary.unresolved).toBe(1);
  });

  it("flags a mention of the current user and tracks the last commenter", () => {
    const r = review([
      thread({ comments: [comment("please look @<user-1>", "Alice"), comment("ok", "Bob")] }),
    ]);
    const summary = summarizeThreads(r, "user-1");
    expect(summary.mentionsMe).toBe(true);
    expect(summary.lastCommenter).toBe("Bob");
  });

  it("does not flag a mention of someone else", () => {
    const r = review([thread({ comments: [comment("@<user-2> ping", "Alice")] })]);
    expect(summarizeThreads(r, "user-1").mentionsMe).toBe(false);
  });

  it("ignores system-only threads (votes/status)", () => {
    const r = review([
      thread({ isResolved: false, comments: [comment("Alice voted 10", "Alice", true)] }),
    ]);
    const summary = summarizeThreads(r, "user-1");
    expect(summary.unresolved).toBe(0);
    expect(summary.lastCommenter).toBeNull();
  });
});
