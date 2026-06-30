import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommitSearch } from "./CommitSearch";

const searchCommits = vi.hoisted(() => vi.fn());
const listCommitRepositories = vi.hoisted(() => vi.fn());
const subscribeTauriEvent = vi.hoisted(() => vi.fn());

vi.mock("@/lib/azdoCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/azdoCommands")>();
  return {
    ...actual,
    searchCommits: (...args: unknown[]) => searchCommits(...args),
    listCommitRepositories: (...args: unknown[]) => listCommitRepositories(...args),
  };
});
vi.mock("@/lib/tauriEvents", () => ({
  subscribeTauriEvent: (...args: unknown[]) => subscribeTauriEvent(...args),
}));
vi.mock("@/lib/useActiveConnection", () => ({
  useActiveOrganizationId: () => "org-1",
}));
// The activity heatmap and results grid pull in their own queries/rendering
// concerns that are unrelated to the sync-refresh behavior under test.
vi.mock("./CommitActivityHeatmap", () => ({ CommitActivityHeatmap: () => null }));
vi.mock("./CommitResults", () => ({ CommitResults: () => null }));

function renderSearch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CommitSearch />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  searchCommits.mockReset();
  listCommitRepositories.mockReset();
  subscribeTauriEvent.mockReset();
});

describe("CommitSearch sync refresh", () => {
  it("re-runs the last successful search when a commits sync completes", async () => {
    listCommitRepositories.mockResolvedValue([]);
    searchCommits.mockResolvedValue({ commits: [], total: 0 });
    let syncHandler: ((payload: unknown) => void) | undefined;
    subscribeTauriEvent.mockImplementation((_event: string, handler: (payload: unknown) => void) => {
      syncHandler = handler;
      return () => {};
    });

    renderSearch();

    fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "auth" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(searchCommits).toHaveBeenCalledTimes(1));

    syncHandler?.({ orgId: "org-1", scopes: ["commits"] });

    await waitFor(() => expect(searchCommits).toHaveBeenCalledTimes(2));
    expect(searchCommits.mock.calls[1][0]).toMatchObject({ query: "auth" });
  });

  it("does not re-run the search for unrelated sync scopes", async () => {
    listCommitRepositories.mockResolvedValue([]);
    searchCommits.mockResolvedValue({ commits: [], total: 0 });
    let syncHandler: ((payload: unknown) => void) | undefined;
    subscribeTauriEvent.mockImplementation((_event: string, handler: (payload: unknown) => void) => {
      syncHandler = handler;
      return () => {};
    });

    renderSearch();

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(searchCommits).toHaveBeenCalledTimes(1));

    syncHandler?.({ orgId: "org-1", scopes: ["myWorkItems"] });

    // Give any unwanted refetch a chance to fire before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(searchCommits).toHaveBeenCalledTimes(1);
  });
});
