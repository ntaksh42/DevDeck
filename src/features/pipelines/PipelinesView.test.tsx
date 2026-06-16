import { afterEach, describe, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Organization } from "@/lib/azdoCommands";
import { PipelinesView } from "./PipelinesView";

// The demo subscriptions seeded by loadPipelineSubscriptions() live under the
// "contoso" org, matching the browser demo data.
const organizations: Organization[] = [
  {
    id: "contoso",
    name: "contoso",
    displayName: "Contoso",
    baseUrl: "https://dev.azure.com/contoso",
    authProvider: "pat",
    credentialKey: "k",
    authenticatedUserId: "user-1",
    authenticatedUserDisplayName: "Demo User",
    authenticatedUserUniqueName: "demo@example.com",
    createdAt: "2026-06-13T00:00:00Z",
    updatedAt: "2026-06-13T00:00:00Z",
  },
];

afterEach(() => {
  window.localStorage.clear();
});

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
    "shows seeded watched pipelines and reveals run history on expand",
    async () => {
      renderView();
      // The browser demo seeds CI and Nightly as watched pipelines.
      await screen.findByText("Watched pipelines", undefined, { timeout: 8000 });
      const nightlyRow = await screen.findByRole("button", {
        name: /Nightly/,
        expanded: false,
      });
      fireEvent.click(nightlyRow);
      // Expanding loads the pipeline's run history (demo-delayed call).
      await screen.findByText(/20260613\.5/, undefined, { timeout: 8000 });
    },
    15000,
  );
});
