import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Organization } from "@/lib/azdoCommands";
import { PipelinesView } from "./PipelinesView";

const organizations: Organization[] = [
  {
    id: "demo-org",
    name: "demo-org",
    displayName: "Demo Org",
    baseUrl: "https://dev.azure.com/demo-org",
    authProvider: "pat",
    credentialKey: "k",
    authenticatedUserId: "user-1",
    authenticatedUserDisplayName: "Demo User",
    authenticatedUserUniqueName: "demo@example.com",
    createdAt: "2026-06-13T00:00:00Z",
    updatedAt: "2026-06-13T00:00:00Z",
  },
];

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PipelinesView organizations={organizations} />
    </QueryClientProvider>,
  );
}

describe("PipelinesView", () => {
  it(
    "lists runs for the auto-selected project with status badges",
    async () => {
      renderView();
      // The view auto-selects the first demo project, then loads its runs
      // (two sequential demo-delayed calls), so allow a generous timeout.
      await screen.findByText(/20260613\.4/, undefined, { timeout: 8000 });
      // Scope badge assertions to the grid; "Failed"/"Succeeded" also appear
      // as result-filter dropdown options in the control bar.
      const grid = screen.getByRole("grid", { name: "Pipeline runs" });
      expect(within(grid).getByText("Failed")).toBeTruthy();
      expect(within(grid).getByText("Succeeded")).toBeTruthy();
      expect(within(grid).getByText("Running")).toBeTruthy();
    },
    15000,
  );
});
