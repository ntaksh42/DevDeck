import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    "lists changed files and shows a word-highlighted, syntax-highlighted diff on selection",
    async () => {
      const { container } = renderPanel();
      const fileButton = await screen.findByText("app.ts", undefined, { timeout: 8000 });
      fireEvent.click(fileButton);
      // The demo diff adds `const z = 4;`. Syntax highlighting splits the line
      // across nested spans, so check the rendered text rather than a single
      // element's text node (RTL's text matchers only look at direct text
      // children, not descendants).
      await waitFor(() => expect(container.textContent).toMatch(/const z = 4/), {
        timeout: 8000,
      });
      // It also modifies `const y = 2;` -> `const y = 3;`; the changed token is
      // rendered as a highlighted segment span, matching the PR diff view.
      const wordHighlights = container.querySelectorAll(
        'span[class*="bg-green-200"], span[class*="bg-red-200"]',
      );
      expect(wordHighlights.length).toBeGreaterThan(0);
      // Lines without a word-level diff (e.g. the added `const z = 4;`) get
      // syntax highlighting instead.
      expect(container.querySelector(".hljs-keyword")).toBeTruthy();
    },
    15000,
  );

  it(
    "opens the file diff in the browser without toggling the inline diff",
    async () => {
      openExternalUrl.mockClear();
      const { container } = renderPanel(
        "https://dev.azure.com/contoso/demo/_git/repo/commit/demosha",
      );
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
      expect(container.textContent).not.toMatch(/const z = 4/);
    },
    15000,
  );

  it(
    "switches to a side-by-side view that still shows both diff sides",
    async () => {
      const { container } = renderPanel();
      const fileButton = await screen.findByText("app.ts", undefined, { timeout: 8000 });
      fireEvent.click(fileButton);
      await waitFor(() => expect(container.textContent).toMatch(/const z = 4/), {
        timeout: 8000,
      });

      fireEvent.click(screen.getByRole("button", { name: /side-by-side/i }));

      // The side-by-side layout renders a 4-column grid per row (base line#,
      // base content, target line#, target content) instead of the unified
      // 3-column layout.
      await waitFor(() => {
        expect(container.querySelector('[class*="grid-cols-[3rem_1fr_3rem_1fr]"]')).toBeTruthy();
      });
      expect(container.textContent).toMatch(/const z = 4/);
    },
    15000,
  );
});
