import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommitFilesPanel } from "./CommitFilesPanel";

const openExternalUrl = vi.hoisted(() => vi.fn());
vi.mock("@/lib/openExternal", () => ({ openExternalUrl }));

function renderPanel(commitWebUrl?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CommitFilesPanel
        organizationId="demo-org"
        projectId="demo-project"
        repositoryId="demo-repo"
        commitId="demosha"
        commitWebUrl={commitWebUrl}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

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

  it(
    "opens the file diff in the browser without toggling the inline diff",
    async () => {
      openExternalUrl.mockClear();
      renderPanel("https://dev.azure.com/contoso/demo/_git/repo/commit/demosha");
      const openButton = await screen.findByRole(
        "button",
        { name: /open diff for app\.ts in azure devops/i },
        { timeout: 8000 },
      );
      fireEvent.click(openButton);
      expect(openExternalUrl).toHaveBeenCalledWith(
        "https://dev.azure.com/contoso/demo/_git/repo/commit/demosha?path=%2Fsrc%2Fapp.ts",
      );
      // The inline diff stays collapsed when only the open button is used.
      expect(screen.queryByText(/const z = 4/)).toBeNull();
    },
    15000,
  );
});
