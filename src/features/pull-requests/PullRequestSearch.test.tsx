import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

it("does not present a failed initial search as a successful empty result", async () => {
  vi.mocked(searchPullRequests).mockRejectedValue(new Error("All projects failed"));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PullRequestSearch /></QueryClientProvider>);
  const search = screen.getByRole("button", { name: "Search" });
  await waitFor(() => expect(search.hasAttribute("disabled")).toBe(false));
  fireEvent.click(search);
  expect(await screen.findByText("All projects failed")).toBeTruthy();
  expect(screen.queryByText("No pull requests matched.")).toBeNull();
  expect(screen.queryByText(/^No matches yet/)).toBeNull();
  expect(await screen.findByText("Search failed. Run Search to try again.")).toBeTruthy();
});
