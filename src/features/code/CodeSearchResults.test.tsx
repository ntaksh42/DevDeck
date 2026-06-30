import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RepoOption } from "./codeBrowseShared";
import { CodeSearchResults } from "./CodeSearchResults";

const searchCode = vi.fn();
const openExternalUrl = vi.fn();

vi.mock("@/lib/azdoCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/azdoCommands")>();
  return {
    ...actual,
    searchCode: (...args: unknown[]) => searchCode(...args),
  };
});

vi.mock("@/lib/openExternal", () => ({
  openExternalUrl: (...args: unknown[]) => openExternalUrl(...args),
}));

const repo: RepoOption = {
  projectId: "demo-project",
  projectName: "Demo Project",
  repositoryId: "repo-1",
  repositoryName: "demo-repo",
};

const hits = [
  {
    fileName: "main.ts",
    path: "/src/main.ts",
    projectName: "Demo Project",
    repositoryName: "demo-repo",
    branch: "main",
    webUrl: "https://dev.azure.com/contoso/demo-project/_git/demo-repo?path=/src/main.ts",
  },
  {
    fileName: "utils.ts",
    path: "/src/utils.ts",
    projectName: "Demo Project",
    repositoryName: "demo-repo",
    branch: "main",
    webUrl: "https://dev.azure.com/contoso/demo-project/_git/demo-repo?path=/src/utils.ts",
  },
];

beforeEach(() => {
  searchCode.mockReset();
  searchCode.mockResolvedValue({ count: hits.length, results: hits, notice: null });
  openExternalUrl.mockReset();
  openExternalUrl.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

function renderResults(onOpenFile: (path: string) => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CodeSearchResults
        organizationId="contoso"
        repo={repo}
        branch="main"
        query="foo"
        onOpenFile={onOpenFile}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

function rowItem(fileName: string): HTMLElement {
  return screen.getByText(fileName).closest("li") as HTMLElement;
}

describe("CodeSearchResults keyboard navigation", () => {
  it("moves the highlighted row with ArrowDown/ArrowUp and j/k", async () => {
    renderResults();
    await screen.findByText("main.ts");
    const list = screen.getByText("main.ts").closest("ul") as HTMLElement;

    expect(rowItem("main.ts").className).toContain("bg-secondary");
    expect(rowItem("utils.ts").className).not.toContain("bg-secondary");

    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(rowItem("main.ts").className).not.toContain("bg-secondary");
    expect(rowItem("utils.ts").className).toContain("bg-secondary");

    fireEvent.keyDown(list, { key: "k" });
    expect(rowItem("main.ts").className).toContain("bg-secondary");
  });

  it("opens the highlighted file on Enter", async () => {
    const onOpenFile = vi.fn();
    renderResults(onOpenFile);
    await screen.findByText("main.ts");
    const list = screen.getByText("main.ts").closest("ul") as HTMLElement;

    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });

    expect(onOpenFile).toHaveBeenCalledWith("/src/utils.ts");
  });

  it("opens the highlighted result in the browser on Ctrl+Enter", async () => {
    renderResults();
    await screen.findByText("main.ts");
    const list = screen.getByText("main.ts").closest("ul") as HTMLElement;

    fireEvent.keyDown(list, { key: "Enter", ctrlKey: true });

    expect(openExternalUrl).toHaveBeenCalledWith(hits[0].webUrl);
  });
});
