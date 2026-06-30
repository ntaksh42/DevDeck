import { type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type CommitSummary } from "@/lib/azdoCommands";
import { commitPrQueryKey } from "./commitSearchUtils";
import { useCommitPrPrefetch } from "./useCommitPrPrefetch";

function commit(commitId: string): CommitSummary {
  return {
    organizationId: "contoso",
    projectId: "platform",
    projectName: "Platform",
    repositoryId: "azdo-dashboard",
    repositoryName: "azdo-dashboard",
    commitId,
    shortCommitId: commitId.slice(0, 8),
    comment: "test commit",
    authorName: null,
    authorEmail: null,
    authorDate: null,
    webUrl: null,
  };
}

afterEach(() => cleanup());

describe("useCommitPrPrefetch", () => {
  it(
    "batches a visible window of commits into the shared related-PR cache",
    async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
      // The first id maps to a related PR in the demo fixtures
      // (`demoCommitPullRequests`); the second has none, exercising the
      // "no related PRs" cache-population path too.
      const withPr = commit("abcdef1234567890abcdef1234567890abcdef12");
      const withoutPr = commit("beef1234567890abcdef1234567890abcdef1234");

      renderHook(({ visible }: { visible: CommitSummary[] }) => useCommitPrPrefetch(visible), {
        wrapper,
        initialProps: { visible: [withPr, withoutPr] },
      });

      await waitFor(() => {
        expect(client.getQueryData(commitPrQueryKey(withPr))).toBeTruthy();
      });
      expect(client.getQueryData(commitPrQueryKey(withPr))).toHaveLength(1);
      expect(client.getQueryData(commitPrQueryKey(withoutPr))).toEqual([]);
    },
    15000,
  );

  it(
    "does not refetch a commit whose related PRs are already cached",
    async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const cachedCommit = commit("abcdef1234567890abcdef1234567890abcdef12");
      const preexisting = [{ pullRequestId: 1, repositoryId: "r", title: "t", status: "active", myVote: 0, myVoteLabel: "No Vote", webUrl: null }];
      client.setQueryData(commitPrQueryKey(cachedCommit), preexisting);
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );

      renderHook(({ visible }: { visible: CommitSummary[] }) => useCommitPrPrefetch(visible), {
        wrapper,
        initialProps: { visible: [cachedCommit] },
      });

      // Give any (unwanted) fetch a chance to run — longer than the demo
      // harness's simulated response delay — then confirm the pre-existing
      // cache entry was left untouched rather than overwritten by a fresh
      // batch fetch.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(client.getQueryData(commitPrQueryKey(cachedCommit))).toBe(preexisting);
    },
    15000,
  );
});
