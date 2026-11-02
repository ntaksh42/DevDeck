import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PullRequestSearch } from "./PullRequestSearch";
import { demoPullRequests } from "@/lib/demo/prData";
import { searchPullRequests } from "@/lib/azdoCommands";

vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  searchPullRequests: vi.fn().mockRejectedValue(new Error("Unexpected local-cache lookup")),
}));
afterEach(cleanup);

it("opens a live PR summary even when the PR is absent from the local cache", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const pullRequest = { ...demoPullRequests().pullRequests[0], pullRequestId: 90001, title: "Unsynced PR" };
  render(<QueryClientProvider client={client}>
    <PullRequestSearch externalSearch={{ query: "90001", requestId: 1, organizationId: "contoso", pullRequest }} />
  </QueryClientProvider>);
  const grid = await screen.findByRole("grid", { name: "Pull request search results" });
  expect(await within(grid).findByText("Unsynced PR")).toBeTruthy();
  expect(searchPullRequests).not.toHaveBeenCalled();
});
