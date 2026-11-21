import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { searchPullRequests, stopPullRequestSearch, type PullRequestSearchResult, type PullRequestSummary } from "@/lib/azdoCommands";
import { useProgressivePrSearch } from "./useProgressivePrSearch";

vi.mock("@/lib/azdoCommands", async (original) => ({ ...(await original<typeof import("@/lib/azdoCommands")>()), searchPullRequests: vi.fn(), stopPullRequestSearch: vi.fn() }));

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function row(id: number, organizationId = "org-a"): PullRequestSummary {
  return { organizationId, projectId: "p", projectName: "Project", repositoryId: "r", repositoryName: "Repo", pullRequestId: id, title: `PR ${id}`, createdBy: "Ada", status: "active", creationDate: "2026-11-01T00:00:00Z", closedDate: null, sourceRefName: "feature", targetRefName: "main", webUrl: null, isDraft: false };
}
function page(rows: PullRequestSummary[], more = false): PullRequestSearchResult {
  return { pullRequests: rows, total: rows.length, truncated: more, warnings: [], searchId: "search", continuationToken: more ? "cursor" : null, scannedCount: 200, searchComplete: !more, hasMore: more, failedScopes: [] };
}
function mount(org = "org-a") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return renderHook(({ organizationId }) => useProgressivePrSearch(organizationId, true), { initialProps: { organizationId: org }, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(stopPullRequestSearch).mockResolvedValue(undefined); });
afterEach(cleanup);

describe("progressive PR search state", () => {
  it("continues after zero matches and merges duplicate rows without losing existing results", async () => {
    vi.mocked(searchPullRequests).mockResolvedValueOnce(page([], true)).mockResolvedValueOnce(page([row(1), row(2)], true)).mockResolvedValueOnce(page([row(2), row(3)]));
    const { result } = mount();
    act(() => result.current.start({ query: "slow" }));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.result?.hasMore).toBe(true);
    act(() => result.current.continueSearch());
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    act(() => result.current.continueSearch());
    await waitFor(() => expect(result.current.rows).toHaveLength(3));
    expect(vi.mocked(searchPullRequests).mock.lastCall?.[0]).toEqual(expect.objectContaining({ query: "slow", continuationToken: "cursor" }));
  });

  it("rejects stale responses from a superseded search", async () => {
    const first = deferred<PullRequestSearchResult>();
    vi.mocked(searchPullRequests).mockReturnValueOnce(first.promise).mockResolvedValueOnce(page([row(2)]));
    const { result } = mount();
    act(() => result.current.start({ query: "old" }));
    await waitFor(() => expect(searchPullRequests).toHaveBeenCalledTimes(1));
    act(() => result.current.start({ query: "new" }));
    await waitFor(() => expect(result.current.rows[0]?.pullRequestId).toBe(2));
    await act(async () => first.resolve(page([row(1)])));
    expect(result.current.rows.map((pr) => pr.pullRequestId)).toEqual([2]);
  });

  it("clears rows on organization changes and ignores old organization responses", async () => {
    const first = deferred<PullRequestSearchResult>();
    vi.mocked(searchPullRequests).mockReturnValueOnce(first.promise);
    const { result, rerender } = mount();
    act(() => result.current.start({ query: "old" }));
    await waitFor(() => expect(searchPullRequests).toHaveBeenCalledTimes(1));
    rerender({ organizationId: "org-b" });
    await act(async () => first.resolve(page([row(1)])));
    expect(result.current.rows).toEqual([]);
    expect(result.current.searched).toBe(false);
  });

  it("stops the initial search using its generated search id and retains its continuation", async () => {
    const first = deferred<PullRequestSearchResult>();
    vi.mocked(searchPullRequests).mockReturnValueOnce(first.promise);
    const { result } = mount();
    act(() => result.current.start({ query: "slow" }));
    await waitFor(() => expect(searchPullRequests).toHaveBeenCalledTimes(1));
    await act(async () => result.current.stop());
    expect(stopPullRequestSearch).toHaveBeenCalledWith({ organizationId: "org-a", searchId: vi.mocked(searchPullRequests).mock.calls[0][0].searchId });
    expect(result.current.stopping).toBe(true);
    await act(async () => first.resolve(page([], true)));
    expect(result.current.result?.hasMore).toBe(true);
    expect(result.current.pending).toBe(false);
  });

  it("preserves rows and continuation when the next action fails", async () => {
    vi.mocked(searchPullRequests).mockResolvedValueOnce(page([row(1)], true)).mockRejectedValueOnce(new Error("Search expired. Run Search again."));
    const { result } = mount();
    act(() => result.current.start({ query: "slow" }));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    act(() => result.current.continueSearch());
    await waitFor(() => expect(result.current.error).toContain("expired"));
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.result?.continuationToken).toBe("cursor");
  });
});
