import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CommitSummary } from "@/lib/azdoCommands";
import { CommitResults } from "./CommitResults";

function commit(overrides: Partial<CommitSummary>): CommitSummary {
  return {
    organizationId: "contoso",
    projectId: "proj-1",
    projectName: "Platform",
    repositoryId: "repo-1",
    repositoryName: "Repo",
    commitId: "sha",
    shortCommitId: "sha",
    comment: "A commit",
    authorName: null,
    authorEmail: null,
    authorDate: null,
    webUrl: null,
    ...overrides,
  };
}

// Sorted newest-first by default (date desc), so with these authorDate values
// the grid order is c1, c2, c3.
const c1 = commit({ commitId: "c1-sha", shortCommitId: "c1-sha", authorDate: "2026-01-03T00:00:00Z" });
const c2 = commit({ commitId: "c2-sha", shortCommitId: "c2-sha", authorDate: "2026-01-02T00:00:00Z" });
const c3 = commit({ commitId: "c3-sha", shortCommitId: "c3-sha", authorDate: "2026-01-01T00:00:00Z" });

function renderResults() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CommitResults loading={false} results={[c1, c2, c3]} searched />
    </QueryClientProvider>,
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe("CommitResults two-commit compare selection", () => {
  it("marks two commits via Shift+click and shows the compare panel", async () => {
    renderResults();
    const grid = screen.getByRole("grid", { name: /commit search results/i });
    await within(grid).findByText("c1-sha");
    // Row 0 in the role="row" list is the column header; commit rows follow
    // in sorted (date desc) order: c1, c2, c3. Click the row container itself
    // (not the SHA button, which stops propagation to open the web URL) so
    // Shift+click reaches the grid's row-select handler.
    const rows = within(grid).getAllByRole("row");
    fireEvent.click(rows[1], { shiftKey: true });
    fireEvent.click(rows[2], { shiftKey: true });

    expect(await screen.findByText(/Comparing: c1-sha → c2-sha/)).toBeTruthy();
    expect(screen.getByText("Compare")).toBeTruthy();
  });

  it("marks the focused row for compare with Space and clears it with Escape", async () => {
    renderResults();
    const grid = screen.getByRole("grid", { name: /commit search results/i });

    // selectedIndex starts at 0 (c1); Space marks it as the first compare pick.
    fireEvent.keyDown(grid, { key: " " });
    expect(await screen.findByText(/Comparing: c1-sha vs —/)).toBeTruthy();

    // Move to c2 and mark it too; both picks are now made and the panel swaps in.
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: " " });
    expect(await screen.findByText(/Comparing: c1-sha → c2-sha/)).toBeTruthy();

    // Escape on the grid clears the whole compare selection.
    fireEvent.keyDown(grid, { key: "Escape" });
    expect(screen.queryByText(/Comparing:/)).toBeNull();
  });

  it("un-marks an already-marked commit when toggled again", async () => {
    renderResults();
    const grid = screen.getByRole("grid", { name: /commit search results/i });

    fireEvent.keyDown(grid, { key: " " });
    expect(await screen.findByText(/Comparing: c1-sha vs —/)).toBeTruthy();

    fireEvent.keyDown(grid, { key: " " });
    expect(screen.queryByText(/Comparing:/)).toBeNull();
  });
});
