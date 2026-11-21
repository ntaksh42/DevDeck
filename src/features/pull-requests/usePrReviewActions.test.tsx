import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReviewPullRequestSummary } from "@/lib/azdoCommands";
import { usePrReviewActions } from "./usePrReviewActions";

const prA: ReviewPullRequestSummary = {
  organizationId: "contoso",
  projectId: "project-1",
  projectName: "Platform",
  repositoryId: "repo-1",
  repositoryName: "azdo-dashboard",
  pullRequestId: 101,
  title: "PR A",
  createdBy: "Author",
  creationDate: "2026-06-14T00:00:00Z",
  targetRefName: "main",
  webUrl: null,
  myVote: 0,
  myVoteLabel: "No vote",
  myIsRequired: false,
  isDraft: false,
  mergeStatus: null,
  ciStatus: null,
  ciContext: null,
  ciCheckCount: 0,
};

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe("usePrReviewActions", () => {
  it("drops a title / description edit when another PR is selected", () => {
    const { result, rerender } = renderHook(({ pr }) => usePrReviewActions(pr), {
      wrapper,
      initialProps: { pr: prA },
    });
    act(() => result.current.startEditingDetails("PR A", "about A"));
    expect(result.current.editingDetails).toBe(true);

    rerender({ pr: { ...prA, pullRequestId: 102, title: "PR B" } });
    expect(result.current.editingDetails).toBe(false);
  });
});
