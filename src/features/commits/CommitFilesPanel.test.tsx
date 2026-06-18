import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommitFilesPanel } from "./CommitFilesPanel";

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CommitFilesPanel
        organizationId="demo-org"
        projectId="demo-project"
        repositoryId="demo-repo"
        commitId="demosha"
      />
    </QueryClientProvider>,
  );
}

describe("CommitFilesPanel", () => {
  it(
    "lists changed files and shows a word-highlighted diff on selection",
    async () => {
      const { container } = renderPanel();
      const fileButton = await screen.findByText("app.ts", undefined, { timeout: 8000 });
      fireEvent.click(fileButton);
      // The demo diff adds `const z = 4;`.
      expect(await screen.findByText(/const z = 4/, undefined, { timeout: 8000 })).toBeTruthy();
      // It also modifies `const y = 2;` -> `const y = 3;`; the changed token is
      // rendered as a highlighted segment span, matching the PR diff view.
      const highlights = container.querySelectorAll(
        'span[class*="bg-green-200"], span[class*="bg-red-200"]',
      );
      expect(highlights.length).toBeGreaterThan(0);
    },
    15000,
  );
});
