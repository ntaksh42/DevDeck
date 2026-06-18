import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Organization } from "@/lib/azdoCommands";
import { MyReviewsGrid } from "./MyReviewsGrid";

// Runs against demo data (browser runtime), so the grid loads the demo review
// PRs for the contoso org without mocking the shared command module — mocking it
// here would leak into other test files that rely on the real demo commands.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const organizations: Organization[] = [
  {
    id: "contoso",
    name: "Contoso",
    displayName: null,
    baseUrl: "https://dev.azure.com/contoso",
    authProvider: "pat",
    credentialKey: "azdodeck:org:contoso:pat",
    authenticatedUserId: null,
    authenticatedUserDisplayName: null,
    authenticatedUserUniqueName: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  },
];

function renderGrid() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MyReviewsGrid organizations={organizations} />
    </QueryClientProvider>,
  );
}

describe("MyReviewsGrid empty states", () => {
  it("shows an achievement message when a filter matches nothing", async () => {
    renderGrid();
    // Wait for demo PRs to load (status bar reports a non-zero total).
    await waitFor(() => {
      expect(screen.getByText(/not voted/)).toBeTruthy();
    });
    fireEvent.change(screen.getByPlaceholderText("Filter by repo, title, author…"), {
      target: { value: "zzz-nonexistent-term" },
    });
    expect(await screen.findByText("All caught up! No pending reviews.")).toBeTruthy();
    // The neutral "no data" message must not appear when data exists.
    expect(screen.queryByText("No pull requests assigned to you.")).toBeNull();
  });
});
