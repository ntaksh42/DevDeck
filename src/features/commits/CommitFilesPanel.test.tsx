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
    "lists changed files and shows a diff on selection",
    async () => {
      renderPanel();
      const fileButton = await screen.findByText("app.ts", undefined, { timeout: 8000 });
      fireEvent.click(fileButton);
      // The demo diff adds `const z = 4;`.
      expect(await screen.findByText(/const z = 4/, undefined, { timeout: 8000 })).toBeTruthy();
    },
    15000,
  );
});
