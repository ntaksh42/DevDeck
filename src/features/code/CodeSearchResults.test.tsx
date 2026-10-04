import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CodeSearchResults } from "./CodeSearchResults";

const openExternalUrl = vi.fn();
vi.mock("@/lib/openExternal", () => ({
  openExternalUrl: (url: string) => openExternalUrl(url),
}));
import { type RepoOption } from "./codeBrowseShared";

const repo: RepoOption = {
  projectId: "p1",
  projectName: "Demo Project",
  repositoryId: "r1",
  repositoryName: "azdo-dashboard",
};

// Drives the browser demo runtime (no Tauri), so searchCode/getCodeSearchContext
// resolve via the demo dispatchers.
function renderResults(onOpenFile: (path: string) => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CodeSearchResults
        organizationId="demo"
        repo={repo}
        branch="main"
        query="searchCode"
        onOpenFile={onOpenFile}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("CodeSearchResults", () => {
  it("lists hits with the total match count", async () => {
    renderResults();
    expect(await screen.findByText("azdoCommands.ts")).toBeTruthy();
    expect(screen.getByText(/137 matches for/)).toBeTruthy();
  });

  it("expands a hit to preview the matching lines with context", async () => {
    renderResults();
    await screen.findByText("azdoCommands.ts");
    const toggles = screen.getAllByRole("button", { name: "Show matches" });
    fireEvent.click(toggles[0]);
    // A non-match context line renders as plain text in its own node.
    expect(await screen.findByText(/Promise<CodeSearchResults>/)).toBeTruthy();
  });
});

describe("CodeSearchResults keyboard navigation", () => {
  async function openButtons(): Promise<HTMLElement[]> {
    await screen.findByText("azdoCommands.ts");
    return Array.from(document.querySelectorAll<HTMLElement>("[data-search-hit]"));
  }

  it("moves focus between hits with arrows and J/K", async () => {
    renderResults();
    const hits = await openButtons();
    expect(hits.length).toBeGreaterThan(1);
    hits[0].focus();

    fireEvent.keyDown(hits[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(hits[1]);
    fireEvent.keyDown(hits[1], { key: "k" });
    expect(document.activeElement).toBe(hits[0]);
    fireEvent.keyDown(hits[0], { key: "j" });
    expect(document.activeElement).toBe(hits[1]);
    fireEvent.keyDown(hits[1], { key: "End" });
    expect(document.activeElement).toBe(hits[hits.length - 1]);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
    expect(document.activeElement).toBe(hits[0]);
  });

  it("opens the focused hit in the browser with Ctrl+Enter", async () => {
    renderResults();
    const hits = await openButtons();
    hits[1].focus();

    fireEvent.keyDown(hits[1], { key: "Enter", ctrlKey: true });

    expect(openExternalUrl).toHaveBeenCalledWith(hits[1].dataset.webUrl);
    expect(hits[1].dataset.webUrl).toMatch(/^https:/);
  });

  it("does not hijack arrow keys from the path filter input", async () => {
    renderResults();
    const hits = await openButtons();
    const filter = screen.getByLabelText("Filter results by path");
    filter.focus();

    fireEvent.keyDown(filter, { key: "ArrowDown" });

    expect(document.activeElement).toBe(filter);
    expect(hits.length).toBeGreaterThan(0);
  });
});
