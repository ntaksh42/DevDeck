import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Organization } from "@/lib/azdoCommands";
import { CodeSearchView } from "./CodeSearchView";

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
    createdAt: "2026-06-14T00:00:00Z",
    updatedAt: "2026-06-14T00:00:00Z",
  },
];

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CodeSearchView organizations={organizations} />
    </QueryClientProvider>,
  );
}

describe("CodeSearchView", () => {
  it(
    "lists code hits after a search",
    async () => {
      renderView();
      fireEvent.change(screen.getByPlaceholderText("text, symbol, or filename"), {
        target: { value: "AdoClient" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Search" }));
      expect(
        await screen.findByText("azdoCommands.ts", undefined, { timeout: 8000 }),
      ).toBeTruthy();
      expect(screen.getByText("App.tsx")).toBeTruthy();
    },
    15000,
  );
});
