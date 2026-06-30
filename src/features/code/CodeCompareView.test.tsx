import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CodeCompareView } from "./CodeCompareView";
import type { RepoOption } from "./codeBrowseShared";

const repo: RepoOption = {
  projectId: "demo-project",
  projectName: "Demo Project",
  repositoryId: "demo-repo",
  repositoryName: "demo-repo",
};

const branchOptions = [
  { value: "main", label: "main" },
  { value: "develop", label: "develop" },
];

function renderView(selectedPath: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CodeCompareView
        organizationId="demo-org"
        repo={repo}
        branch="main"
        branchOptions={branchOptions}
        selectedPath={selectedPath}
      />
    </QueryClientProvider>,
  );
}

async function pickBaseBranch(value: string) {
  const baseCombo = await screen.findByRole("combobox", { name: "Base branch" }, { timeout: 8000 });
  fireEvent.mouseDown(baseCombo);
  fireEvent.pointerDown(await screen.findByText(value, undefined, { timeout: 8000 }));
}

afterEach(() => cleanup());

describe("CodeCompareView", () => {
  it("prompts for a base and target revision before comparing", () => {
    renderView();
    expect(screen.getByText("Pick a base and target revision to compare.")).toBeTruthy();
  });

  it(
    "lists changed files between the picked revisions and shows a diff on selection",
    async () => {
      renderView();
      await pickBaseBranch("develop");
      const fileButton = await screen.findByText("/README.md", undefined, { timeout: 8000 });
      fireEvent.click(fileButton);
      // The demo diff appends a "## Compare" section to the target README.
      expect(await screen.findByText(/## Compare/, undefined, { timeout: 8000 })).toBeTruthy();
    },
    15000,
  );

  it(
    "preselects the file open in the tree when it is part of the changed set",
    async () => {
      renderView("/README.md");
      await pickBaseBranch("develop");
      // No click needed: the open file is auto-selected once it's in the diff.
      expect(await screen.findByText(/## Compare/, undefined, { timeout: 8000 })).toBeTruthy();
    },
    15000,
  );

  it(
    "toggles between unified and split view modes",
    async () => {
      renderView();
      await pickBaseBranch("develop");
      fireEvent.click(await screen.findByText("/README.md", undefined, { timeout: 8000 }));
      await screen.findByText(/## Compare/, undefined, { timeout: 8000 });

      const splitTab = screen.getByRole("tab", { name: "Split" });
      const unifiedTab = screen.getByRole("tab", { name: "Unified" });
      expect(unifiedTab.getAttribute("aria-selected")).toBe("true");
      fireEvent.click(splitTab);
      expect(splitTab.getAttribute("aria-selected")).toBe("true");
      expect(unifiedTab.getAttribute("aria-selected")).toBe("false");
      // The diff still renders after switching view modes.
      expect(await screen.findByText(/## Compare/, undefined, { timeout: 8000 })).toBeTruthy();
    },
    15000,
  );

  it(
    "toggles ignore-whitespace and word-wrap options",
    async () => {
      renderView();
      await pickBaseBranch("develop");
      fireEvent.click(await screen.findByText("/README.md", undefined, { timeout: 8000 }));
      await screen.findByText(/## Compare/, undefined, { timeout: 8000 });

      const ignoreWhitespace = screen.getByRole("button", { name: "Ignore whitespace" });
      expect(ignoreWhitespace.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(ignoreWhitespace);
      expect(ignoreWhitespace.getAttribute("aria-pressed")).toBe("true");

      const wrap = screen.getByRole("button", { name: "Wrap" });
      expect(wrap.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(wrap);
      expect(wrap.getAttribute("aria-pressed")).toBe("true");
    },
    15000,
  );
});
