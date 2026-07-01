import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommitFilesPanel } from "./CommitFilesPanel";

const openExternalUrl = vi.hoisted(() => vi.fn());
vi.mock("@/lib/openExternal", () => ({ openExternalUrl }));

function renderPanel(commitWebUrl?: string, commitId = "demosha") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CommitFilesPanel
        organizationId="demo-org"
        projectId="demo-project"
        repositoryId="demo-repo"
        commitId={commitId}
        commitWebUrl={commitWebUrl}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

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

  it(
    "shows per-file and commit-wide added/removed line counts",
    async () => {
      renderPanel();
      await screen.findByText("app.ts", undefined, { timeout: 8000 });
      // Each changed file's diff is fetched eagerly so a count badge can show
      // without the user opening it; the demo diff adds 2 lines and removes 1
      // for every file, so each row's badge reads "+2 -1".
      const perFileAdds = await screen.findAllByText("+2", undefined, { timeout: 8000 });
      expect(perFileAdds.length).toBeGreaterThanOrEqual(2);
      // The commit-wide summary in the header sums both files.
      expect(await screen.findByText("+4", undefined, { timeout: 8000 })).toBeTruthy();
      expect(await screen.findByText("-2", undefined, { timeout: 8000 })).toBeTruthy();
    },
    15000,
  );

  it(
    "shows a parent selector for a merge commit and resets the open diff when it changes",
    async () => {
      renderPanel(undefined, "demomerge");
      await screen.findByText("app.ts", undefined, { timeout: 8000 });
      const select = await screen.findByLabelText(
        "Parent commit to diff against",
        undefined,
        { timeout: 8000 },
      );
      const options = within(select as HTMLSelectElement).getAllByRole("option");
      expect(options).toHaveLength(2);

      fireEvent.click(screen.getByText("app.ts"));
      expect(await screen.findByText(/const z = 4/, undefined, { timeout: 8000 })).toBeTruthy();

      fireEvent.change(select, {
        target: { value: options[1].getAttribute("value") },
      });
      // Switching parents invalidates the open diff context, so it closes.
      expect(screen.queryByText(/const z = 4/)).toBeNull();
    },
    15000,
  );

  it(
    "moves the open file with j/k and keeps a roving tab stop",
    async () => {
      renderPanel();
      await screen.findByText("app.ts", undefined, { timeout: 8000 });
      // The keydown handler lives on an ancestor of the file rows; dispatch
      // from a row so the event bubbles through it (firing on the RTL root
      // container would bubble the wrong way, past the handler).
      let appRow = screen.getByTitle("/src/app.ts");

      fireEvent.keyDown(appRow, { key: "j" });
      expect(await screen.findByText(/const z = 4/, undefined, { timeout: 8000 })).toBeTruthy();
      appRow = screen.getByTitle("/src/app.ts");
      expect(appRow.parentElement?.className).toMatch(/bg-secondary/);
      expect(appRow.getAttribute("tabindex")).toBe("0");

      fireEvent.keyDown(appRow, { key: "j" });
      const readmeRow = screen.getByTitle("/README.md");
      expect(readmeRow.parentElement?.className).toMatch(/bg-secondary/);
      expect(appRow.parentElement?.className).not.toMatch(/bg-secondary/);
      expect(readmeRow.getAttribute("tabindex")).toBe("0");
      expect(appRow.getAttribute("tabindex")).toBe("-1");

      fireEvent.keyDown(readmeRow, { key: "k" });
      expect(appRow.parentElement?.className).toMatch(/bg-secondary/);
    },
    15000,
  );

  it(
    "jumps between diff hunks with n/p without moving focus off the file row",
    async () => {
      Element.prototype.scrollIntoView = vi.fn();
      renderPanel();
      await screen.findByText("app.ts", undefined, { timeout: 8000 });
      fireEvent.click(screen.getByText("app.ts"));
      await screen.findByText(/const z = 4/, undefined, { timeout: 8000 });
      const appRow = screen.getByTitle("/src/app.ts");
      appRow.focus();

      fireEvent.keyDown(appRow, { key: "n" });
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
      // Focus stays on the file row (not moved into the diff), so the panel's
      // Esc/ArrowLeft-to-grid path keeps working.
      expect(document.activeElement).toBe(appRow);
    },
    15000,
  );
});
