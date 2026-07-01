import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CodeBrowseView } from "./CodeBrowseView";

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
      fireEvent.click(screen.getByRole("button", { name: "History" }));
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
      fireEvent.click(await screen.findByRole("button", { name: "Compare" }, { timeout: 8000 }));
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

  it(
    "navigates back to the root from the breadcrumb",
    async () => {
      renderView();
      await selectDemoRepository();
      await waitFor(() => expect(screen.getAllByText("src").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      // Open the src folder from the tree, then click the repository name in
      // the breadcrumb to return to the root folder listing.
      fireEvent.click(screen.getAllByText("src")[0]);
      await waitFor(() => expect(screen.getAllByText("App.tsx").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      fireEvent.click(screen.getByRole("button", { name: "azdo-dashboard" }));
      await waitFor(
        () => expect(screen.getAllByText("package.json").length).toBeGreaterThan(0),
        { timeout: 8000 },
      );
    },
    15000,
  );

  it(
    "moves through the folder table with arrow keys",
    async () => {
      renderView();
      await selectDemoRepository();
      await waitFor(() => expect(screen.getAllByText("package.json").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      const rows = Array.from(
        lastContainer.querySelectorAll<HTMLButtonElement>("[data-folder-item]"),
      );
      expect(rows.length).toBeGreaterThan(1);
      rows[0].focus();
      fireEvent.keyDown(rows[0], { key: "ArrowDown" });
      expect(document.activeElement).toBe(rows[1]);
      fireEvent.keyDown(rows[1], { key: "k" });
      expect(document.activeElement).toBe(rows[0]);
      fireEvent.keyDown(rows[0], { key: "End" });
      expect(document.activeElement).toBe(rows[rows.length - 1]);
    },
    15000,
  );

  it(
    "renders an image preview for image files",
    async () => {
      renderView();
      await selectDemoRepository();
      await waitFor(() => expect(screen.getAllByText("assets").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      fireEvent.click(screen.getAllByText("assets")[0]);
      const logo = await screen.findAllByText("logo.png", undefined, { timeout: 8000 });
      fireEvent.click(logo[0]);
      await waitFor(
        () => {
          const image = lastContainer.querySelector<HTMLImageElement>("img[alt='logo.png']");
          expect(image?.src ?? "").toContain("data:image/png;base64");
        },
        { timeout: 8000 },
      );
    },
    15000,
  );

  it(
    "filters files across unexpanded folders",
    async () => {
      renderView();
      await selectDemoRepository();
      await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      // /src/lib is not expanded, but its files match via the recursive path list.
      const box = screen.getByLabelText(/Filter files by name/i);
      fireEvent.change(box, { target: { value: "azdo" } });
      expect(await screen.findByText("azdoDemo.ts", undefined, { timeout: 8000 })).toBeTruthy();
      fireEvent.click(screen.getByText("azdoCommands.ts"));
      // Opening a match shows the file content in the right pane.
      await waitFor(
        () => {
          const code = lastContainer.querySelector("code.hljs");
          expect(code?.textContent ?? "").toContain("invokeCommand");
        },
        { timeout: 8000 },
      );
    },
    15000,
  );

  it(
    "pins a file to a commit from the History tab",
    async () => {
      renderView();
      await selectDemoRepository();
      await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      fireEvent.click(screen.getAllByText("README.md")[0]);
      fireEvent.click(await screen.findByRole("button", { name: "History" }, { timeout: 8000 }));
      const viewButtons = await screen.findAllByRole("button", { name: "View" }, {
        timeout: 8000,
      });
      fireEvent.click(viewButtons[0]);
      // Back on Contents, pinned to the picked commit, with a way back.
      expect(
        await screen.findByText(/Viewing this file at commit 7219380a/, undefined, {
          timeout: 8000,
        }),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Back to main" }));
      await waitFor(
        () => expect(screen.queryByText(/Viewing this file at commit/)).toBeNull(),
        { timeout: 8000 },
      );
    },
    15000,
  );

  it(
    "compares an open file against a typed ref",
    async () => {
      renderView();
      await selectDemoRepository();
      await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      fireEvent.click(screen.getAllByText("README.md")[0]);
      fireEvent.click(await screen.findByRole("button", { name: "Compare" }, { timeout: 8000 }));
      fireEvent.change(screen.getByLabelText("Compare base commit or tag"), {
        target: { value: "abc1234" },
      });
      // Demo file content is ref-independent, so the two sides match.
      expect(
        await screen.findByText(/No differences between abc1234 and main/, undefined, {
          timeout: 8000,
        }),
      ).toBeTruthy();
    },
    15000,
  );

  it(
    "opens find-in-file with Ctrl+F from anywhere in the view",
    async () => {
      renderView();
      await selectDemoRepository();
      await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      fireEvent.click(screen.getAllByText("README.md")[0]);
      await waitFor(() => expect(lastContainer.querySelector("code.hljs")).not.toBeNull(), {
        timeout: 8000,
      });
      fireEvent.keyDown(document, { key: "f", ctrlKey: true });
      expect(await screen.findByLabelText("Find in file", undefined, { timeout: 8000 })).toBeTruthy();
    },
    15000,
  );

  it(
    "restores the last opened file across remounts",
    async () => {
      const first = renderView();
      await selectDemoRepository();
      await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0), {
        timeout: 8000,
      });
      fireEvent.click(screen.getAllByText("README.md")[0]);
      await waitFor(() => expect(lastContainer.querySelector("code.hljs")).not.toBeNull(), {
        timeout: 8000,
      });
      first.unmount();

      // A fresh mount reopens the same file without any clicks.
      renderView();
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
});
