import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  cleanup();
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

  it(
    "keeps the detail panel when unwatching a different pipeline in the same project",
    async () => {
      // CI (definition 1) and Nightly (definition 2) both live in demo-project.
      renderView();
      await screen.findByText("Watched pipelines", undefined, { timeout: 8000 });

      // Open Nightly and select one of its runs into the detail panel.
      const nightlyRow = await screen.findByRole("button", {
        name: /Nightly/,
        expanded: false,
      });
      fireEvent.click(nightlyRow);
      const nightlyGrid = await screen.findByRole(
        "grid",
        { name: /Nightly runs/ },
        { timeout: 8000 },
      );
      const runRows = within(nightlyGrid).getAllByRole("row");
      fireEvent.click(runRows[0]);

      // The detail panel now shows a run, not the empty placeholder.
      await screen.findByText("Branch", undefined, { timeout: 8000 });
      expect(screen.queryByText("Select a run.")).toBeNull();

      // Unwatch CI (a different pipeline in the same project).
      const removeCi = screen.getByRole("button", {
        name: /Remove CI from watched pipelines/,
      });
      fireEvent.click(removeCi);

      // The detail panel must still show the Nightly run, not be cleared.
      expect(screen.queryByText("Select a run.")).toBeNull();
      expect(screen.getByText("Branch")).toBeTruthy();
    },
    15000,
  );
});
