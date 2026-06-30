import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CodeSearchResults } from "./CodeSearchResults";
import { type RepoOption } from "./codeBrowseShared";

const repo: RepoOption = {
  projectId: "p1",
  projectName: "Demo Project",
  repositoryId: "r1",
  repositoryName: "azdo-dashboard",
};

// Drives the browser demo runtime (no Tauri), so searchCode/getCodeSearchContext
// resolve via the demo dispatchers.
function renderResults() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CodeSearchResults
        organizationId="demo"
        repo={repo}
        branch="main"
        query="searchCode"
        onOpenFile={() => {}}
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
