import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommitSummary } from "@/lib/azdoCommands";

const getCommitPullRequestsBatch = vi.fn();
vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  getCommitPullRequestsBatch: (...args: unknown[]) => getCommitPullRequestsBatch(...args),
}));

import { isUnlinkedCommit } from "./commitLinks";
import { useUnlinkedCommitFilter } from "./useUnlinkedCommitFilter";

function commit(id: string, comment: string): CommitSummary {
  return {
    organizationId: "contoso",
    projectId: "p1",
    projectName: "Platform",
    repositoryId: "repo-1",
    repositoryName: "repo-1",
    commitId: id,
    shortCommitId: id,
    comment,
    authorName: null,
    authorEmail: null,
    authorDate: null,
    webUrl: null,
  };
}

const pr = { pullRequestId: 7, repositoryId: "repo-1", title: "PR", status: "active", myVote: 0, myVoteLabel: "No Vote", webUrl: null };

describe("isUnlinkedCommit", () => {
  it("needs a finished lookup with no PR and no AB# mention", () => {
    expect(isUnlinkedCommit(commit("a", "plain"), undefined)).toBe(false);
    expect(isUnlinkedCommit(commit("a", "plain"), 0)).toBe(true);
    expect(isUnlinkedCommit(commit("a", "plain"), 1)).toBe(false);
    expect(isUnlinkedCommit(commit("a", "Fix AB#12"), 0)).toBe(false);
  });
});

describe("useUnlinkedCommitFilter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getCommitPullRequestsBatch.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("keeps every row while off and does not query", async () => {
    const rows = [commit("a", "plain")];
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUnlinkedCommitFilter(rows), { wrapper });
    await vi.advanceTimersByTimeAsync(300);

    expect(result.current.rows).toEqual(rows);
    expect(getCommitPullRequestsBatch).not.toHaveBeenCalled();
  });

  it("when on, looks up only commits without AB# and keeps those in no PR", async () => {
    getCommitPullRequestsBatch.mockResolvedValue({ a: [], b: [pr] });
    const rows = [commit("a", "plain"), commit("b", "in a PR"), commit("c", "Fix AB#5")];
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUnlinkedCommitFilter(rows), { wrapper });

    act(() => result.current.toggle());
    expect(result.current.rows).toEqual([]);
    expect(result.current.pending).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(getCommitPullRequestsBatch).toHaveBeenCalledWith(
      expect.objectContaining({ commitIds: ["a", "b"] }),
    );
    expect(result.current.rows.map((row) => row.commitId)).toEqual(["a"]);
    expect(result.current.pending).toBe(0);
  });
});
