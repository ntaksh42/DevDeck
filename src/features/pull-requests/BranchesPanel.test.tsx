import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BranchesPanel } from "./BranchesPanel";

afterEach(cleanup);

function renderPanel(onCreatePrFromBranch?: (branchName: string) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BranchesPanel
        organizationId="contoso"
        project="platform"
        repository="azdo-dashboard"
        onOpenPullRequest={vi.fn()}
        onCreatePrFromBranch={onCreatePrFromBranch}
      />
    </QueryClientProvider>,
  );
}

describe("BranchesPanel", () => {
  it(
    "lists demo branches with ahead/behind counts and the default badge",
    async () => {
      renderPanel();
      expect(await screen.findByText("main", {}, { timeout: 8000 })).toBeTruthy();
      expect(screen.getByText("default")).toBeTruthy();
      expect(screen.getByText("feature/pr-search")).toBeTruthy();
      expect(screen.getByText("↑6")).toBeTruthy();
    },
    15000,
  );

  it(
    "links a branch to its active pull request",
    async () => {
      renderPanel();
      // feature/pr-search is the source branch of demo PR #42.
      const prLink = await screen.findByRole("button", { name: "#42" }, { timeout: 8000 });
      expect(prLink).toBeTruthy();
    },
    15000,
  );

  it(
    "offers a New PR action for branches without an open pull request",
    async () => {
      const onCreatePrFromBranch = vi.fn();
      renderPanel(onCreatePrFromBranch);
      await waitFor(() => expect(screen.getByText("chore/dependency-bump")).toBeTruthy(), {
        timeout: 8000,
      });
      const newPrButtons = screen.getAllByRole("button", { name: "New PR" });
      expect(newPrButtons.length).toBeGreaterThan(0);
    },
    15000,
  );
});
