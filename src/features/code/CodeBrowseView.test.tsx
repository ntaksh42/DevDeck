import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CodeBrowseView } from "./CodeBrowseView";
import { MAX_TREE_WIDTH } from "./codeBrowseStorage";

let lastContainer: HTMLElement;

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <CodeBrowseView />
    </QueryClientProvider>,
  );
  lastContainer = result.container;
  return result;
}

// Opens the repository picker and selects the demo repository.
async function selectDemoRepository() {
  const combo = screen.getByRole("combobox", { name: "Repository" }) as HTMLInputElement;
  await waitFor(() => expect(combo.disabled).toBe(false), { timeout: 8000 });
  fireEvent.mouseDown(combo);
  const option = await screen.findByText("Platform / azdo-dashboard", undefined, {
    timeout: 8000,
  });
  fireEvent.pointerDown(option);
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, "", window.location.pathname);
});

describe("CodeBrowseView", () => {
  it("prompts to pick a repository before one is selected", () => {
    renderView();
    expect(screen.getByText("Select a repository to browse its files.")).toBeTruthy();
  });

  it(
    "loads the tree and folder listing after selecting a repository",
    async () => {
      renderView();
      await selectDemoRepository();
      // Root entries appear in both the tree and the folder table.
      await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      expect(screen.getAllByText("src").length).toBeGreaterThan(0);
    },
    15000,
  );

  it(
    "shows commit info in the folder table and renders the README",
    async () => {
      renderView();
      await selectDemoRepository();
      // Latest-commit column (from latestProcessedChange): one per table row.
      await waitFor(
        () => expect(screen.getAllByText("Initial calculator service").length).toBeGreaterThan(0),
        { timeout: 8000 },
      );
      // The folder's README renders as markdown below the table.
      expect(
        await screen.findByText("A Tauri + React dashboard for Azure DevOps.", undefined, {
          timeout: 8000,
        }),
      ).toBeTruthy();
    },
    15000,
  );

  it(
    "shows a file's content when opened from the tree",
    async () => {
      renderView();
      await selectDemoRepository();
      // The tree renders before the folder table, so the first match is the
      // tree node; clicking it opens the file in the right pane.
      await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      fireEvent.click(screen.getAllByText("README.md")[0]);
      // The file pane highlights content into a <code class="hljs"> block.
      await waitFor(
        () => {
          const code = lastContainer.querySelector("code.hljs");
          expect(code?.textContent ?? "").toContain(
            "A Tauri + React dashboard for Azure DevOps.",
          );
        },
        { timeout: 8000 },
      );
    },
    15000,
  );

  it(
    "shows the commit history on the History tab",
    async () => {
      renderView();
      await selectDemoRepository();
      await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      fireEvent.click(screen.getByRole("tab", { name: "History" }));
      expect(
        await screen.findByText("Add expression utilities", undefined, { timeout: 8000 }),
      ).toBeTruthy();
    },
    15000,
  );

  it(
    "runs a full-text search when Enter is pressed in the box",
    async () => {
      renderView();
      await selectDemoRepository();
      // Wait until the repo/branch have settled (tree loaded) so the branch
      // reset effect can't clear the pending search.
      await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      const box = screen.getByLabelText(/Filter files by name/i);
      fireEvent.change(box, { target: { value: "AdoClient" } });
      fireEvent.keyDown(box, { key: "Enter" });
      // The demo search returns hits shown in the results pane.
      expect(
        await screen.findByText("azdoCommands.ts", undefined, { timeout: 8000 }),
      ).toBeTruthy();
      expect(screen.getByText("App.tsx")).toBeTruthy();
    },
    15000,
  );

  it(
    "finds matches within an open file",
    async () => {
      renderView();
      await selectDemoRepository();
      await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      fireEvent.click(screen.getAllByText("README.md")[0]);
      const findButton = await screen.findByRole("button", { name: "Find" }, { timeout: 8000 });
      fireEvent.click(findButton);
      fireEvent.change(screen.getByLabelText("Find in file"), {
        target: { value: "dashboard" },
      });
      await waitFor(() => expect(lastContainer.querySelector("mark")).not.toBeNull(), {
        timeout: 8000,
      });
    },
    15000,
  );

  it(
    "compares an open file against a base branch",
    async () => {
      renderView();
      await selectDemoRepository();
      await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      fireEvent.click(screen.getAllByText("README.md")[0]);
      fireEvent.click(await screen.findByRole("tab", { name: "Compare" }, { timeout: 8000 }));
      const baseCombo = screen.getByRole("combobox", { name: "Compare base branch" });
      fireEvent.mouseDown(baseCombo);
      fireEvent.pointerDown(await screen.findByText("develop", undefined, { timeout: 8000 }));
      // Demo file content is branch-independent, so the two sides match.
      expect(
        await screen.findByText(/No differences between develop and main/, undefined, {
          timeout: 8000,
        }),
      ).toBeTruthy();
    },
    15000,
  );

  it(
    "selects a line range by clicking line numbers and reflects it in the URL hash",
    async () => {
      renderView();
      await selectDemoRepository();
      await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      fireEvent.click(screen.getAllByText("README.md")[0]);
      const line1 = await screen.findByRole("button", { name: "Line 1" }, { timeout: 8000 });
      fireEvent.click(line1);
      const line3 = screen.getByRole("button", { name: "Line 3" });
      fireEvent.click(line3, { shiftKey: true });
      await waitFor(() => expect(window.location.hash).toBe("#L1-L3"));
      expect(screen.getByText("Lines 1-3")).toBeTruthy();
    },
    15000,
  );

  it(
    "extends a line selection with Shift+ArrowDown from the keyboard",
    async () => {
      renderView();
      await selectDemoRepository();
      await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      fireEvent.click(screen.getAllByText("README.md")[0]);
      const line1 = await screen.findByRole("button", { name: "Line 1" }, { timeout: 8000 });
      line1.focus();
      fireEvent.keyDown(line1, { key: "ArrowDown", shiftKey: true });
      await waitFor(() => expect(window.location.hash).toBe("#L1-L2"));
      expect(screen.getByText("Lines 1-2")).toBeTruthy();
    },
    15000,
  );

  it(
    "resizes the tree panel via keyboard and persists the width across remounts",
    async () => {
      const first = renderView();
      await selectDemoRepository();
      await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      const separator = screen.getByRole("separator", { name: "Resize file tree" });
      fireEvent.keyDown(separator, { key: "End" });
      expect(separator.getAttribute("aria-valuenow")).toBe(String(MAX_TREE_WIDTH));
      first.unmount();

      // A fresh mount auto-restores the last repository (see the "remembers"
      // test below), so don't re-select it here.
      renderView();
      await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      expect(
        screen.getByRole("separator", { name: "Resize file tree" }).getAttribute("aria-valuenow"),
      ).toBe(String(MAX_TREE_WIDTH));
    },
    15000,
  );

  it(
    "moves focus between tabs with arrow keys and activates with Enter",
    async () => {
      renderView();
      await selectDemoRepository();
      await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      const contentsTab = screen.getByRole("tab", { name: "Contents" });
      contentsTab.focus();
      fireEvent.keyDown(contentsTab, { key: "ArrowRight" });
      const historyTab = screen.getByRole("tab", { name: "History" });
      expect(document.activeElement).toBe(historyTab);
      // Arrow movement only moves focus (roving tabindex); it doesn't activate.
      expect(historyTab.getAttribute("aria-selected")).toBe("false");
      fireEvent.keyDown(historyTab, { key: "Enter" });
      expect(
        await screen.findByText("Add expression utilities", undefined, { timeout: 8000 }),
      ).toBeTruthy();
      expect(screen.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe(
        "true",
      );
    },
    15000,
  );

  it(
    "remembers the last repository and its favorite across remounts",
    async () => {
      const first = renderView();
      await selectDemoRepository();
      await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      fireEvent.click(screen.getByRole("button", { name: "Add to favorites" }));
      first.unmount();

      // A fresh mount restores the repository without re-selecting it, and the
      // star reflects the persisted favorite.
      renderView();
      await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      expect(screen.getByRole("button", { name: "Remove from favorites" })).toBeTruthy();
    },
    15000,
  );
});
