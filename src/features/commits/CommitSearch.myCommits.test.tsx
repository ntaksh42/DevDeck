import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const searchCommitsMock = vi.fn();

vi.mock("@/lib/azdoCommands", async () => {
  const actual = await vi.importActual<typeof import("@/lib/azdoCommands")>(
    "@/lib/azdoCommands",
  );
  return {
    ...actual,
    searchCommits: (input: unknown) => searchCommitsMock(input),
    listCommitRepositories: () => Promise.resolve([]),
    getCommitPullRequests: () => Promise.resolve([]),
  };
});

import { CommitSearch } from "./CommitSearch";
import type { Organization } from "@/lib/azdoCommands";

const organization: Organization = {
  id: "contoso",
  name: "contoso",
  displayName: "Contoso",
  baseUrl: "https://dev.azure.com/contoso",
  authProvider: "pat",
  credentialKey: "azdodeck:org:contoso:pat",
  authenticatedUserId: "user-1",
  authenticatedUserDisplayName: "Demo User",
  createdAt: "2026-05-24T00:00:00Z",
  updatedAt: "2026-05-24T00:00:00Z",
};

afterEach(() => {
  cleanup();
  searchCommitsMock.mockReset();
  window.localStorage.clear();
});

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CommitSearch organizations={[organization]} myCommitsMode />
    </QueryClientProvider>,
  );
}

describe("CommitSearch My Commits mode", () => {
  it("auto-runs a search seeded with the current user as author", async () => {
    searchCommitsMock.mockResolvedValue([]);
    renderView();

    await waitFor(() => expect(searchCommitsMock).toHaveBeenCalled());
    const input = searchCommitsMock.mock.calls[0][0];
    expect(input.author).toBe("Demo User");
    expect(input.organizationId).toBe("contoso");
    // 90-day window is seeded.
    expect(input.fromDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(input.toDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
