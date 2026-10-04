import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CommitSummary } from "@/lib/azdoCommands";

const getCommitPullRequestsBatch = vi.fn();
vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  getCommitPullRequestsBatch: (...args: unknown[]) => getCommitPullRequestsBatch(...args),
}));

import { commitPrQueryKey } from "./commitSearchUtils";
import { useCommitPrPrefetch } from "./useCommitPrPrefetch";

function commit(id: string, repositoryId = "repo-1"): CommitSummary {
  return {
    organizationId: "contoso",
    projectId: "p1",
    projectName: "Platform",
    repositoryId,
    repositoryName: repositoryId,
    commitId: id,
    shortCommitId: id.slice(0, 7),
    comment: "msg",
    authorName: null,
    authorEmail: null,
    authorDate: null,
    webUrl: null,
  };
}

const pr = {
  pullRequestId: 7,
  repositoryId: "repo-1",
  title: "A PR",
  status: "active",
  myVote: 0,
  myVoteLabel: "No Vote",
  webUrl: null,
};

beforeEach(() => {
  vi.useFakeTimers();
  getCommitPullRequestsBatch.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function setup(commits: CommitSummary[]) {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(({ rows }) => useCommitPrPrefetch(rows), {
    wrapper,
    initialProps: { rows: commits },
  });
  return { client, ...hook };
}

describe("useCommitPrPrefetch", () => {
  it("fetches the visible commits in one batched request per repository and fills the cache", async () => {
    getCommitPullRequestsBatch.mockResolvedValue({ a1: [pr], a2: [] });
    const rows = [commit("a1"), commit("a2")];
    const { client } = setup(rows);

    await vi.advanceTimersByTimeAsync(300);

    expect(getCommitPullRequestsBatch).toHaveBeenCalledTimes(1);
    expect(getCommitPullRequestsBatch).toHaveBeenCalledWith({
      organizationId: "contoso",
      repositoryId: "repo-1",
      commitIds: ["a1", "a2"],
    });
    expect(client.getQueryData(commitPrQueryKey(rows[0]))).toEqual([pr]);
    expect(client.getQueryData(commitPrQueryKey(rows[1]))).toEqual([]);
  });

  it("issues a separate request per repository", async () => {
    getCommitPullRequestsBatch.mockResolvedValue({});
    setup([commit("a1", "repo-1"), commit("b1", "repo-2")]);

    await vi.advanceTimersByTimeAsync(300);

    expect(getCommitPullRequestsBatch).toHaveBeenCalledTimes(2);
  });

  it("skips commits that are already cached", async () => {
    getCommitPullRequestsBatch.mockResolvedValue({ a2: [] });
    const rows = [commit("a1"), commit("a2")];
    const client = new QueryClient();
    client.setQueryData(commitPrQueryKey(rows[0]), [pr]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useCommitPrPrefetch(rows), { wrapper });

    await vi.advanceTimersByTimeAsync(300);

    expect(getCommitPullRequestsBatch).toHaveBeenCalledWith(
      expect.objectContaining({ commitIds: ["a2"] }),
    );
  });

  it("debounces: a window that changes before the pause sends only the latest request", async () => {
    getCommitPullRequestsBatch.mockResolvedValue({});
    const { rerender } = setup([commit("a1")]);

    await vi.advanceTimersByTimeAsync(100);
    rerender({ rows: [commit("a2")] });
    await vi.advanceTimersByTimeAsync(300);

    expect(getCommitPullRequestsBatch).toHaveBeenCalledTimes(1);
    expect(getCommitPullRequestsBatch).toHaveBeenCalledWith(
      expect.objectContaining({ commitIds: ["a2"] }),
    );
  });

  it("caches an empty list for commits the response leaves out", async () => {
    getCommitPullRequestsBatch.mockResolvedValue({});
    const rows = [commit("a1")];
    const { client } = setup(rows);

    await vi.advanceTimersByTimeAsync(300);

    expect(client.getQueryData(commitPrQueryKey(rows[0]))).toEqual([]);
  });
});
