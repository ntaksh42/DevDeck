import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  CommitSearchResult,
  WorkItemQueryCountPoint,
} from "@/lib/azdoCommands";
import { AnalyzeView } from "./AnalyzeView";
import { saveAnalyzeGroups, type AnalyzeGroup } from "./analyzeGroupsStorage";

const countWorkItemQueryHistory = vi.fn();
const searchCommits = vi.fn();
const listWorkItemProjects = vi.fn();
const listCommitRepositories = vi.fn();
const listRepoBranches = vi.fn();

vi.mock("@/lib/azdoCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/azdoCommands")>();
  return {
    ...actual,
    countWorkItemQueryHistory: (...args: unknown[]) => countWorkItemQueryHistory(...args),
    searchCommits: (...args: unknown[]) => searchCommits(...args),
    listWorkItemProjects: (...args: unknown[]) => listWorkItemProjects(...args),
    listCommitRepositories: (...args: unknown[]) => listCommitRepositories(...args),
    listRepoBranches: (...args: unknown[]) => listRepoBranches(...args),
  };
});

vi.mock("@/lib/useActiveConnection", () => ({
  useActiveOrganizationId: () => "contoso",
}));

function group(overrides: Partial<AnalyzeGroup> = {}): AnalyzeGroup {
  return {
    id: "g1",
    name: "Payments",
    organizationId: "contoso",
    projectId: "proj1",
    queries: [
      { id: "q1", name: "Bugs — Core", projectId: "", wiql: "SELECT [System.Id] FROM WorkItems" },
    ],
    branches: [
      {
        id: "b1",
        name: "main",
        projectId: "proj1",
        repositoryId: "repo1",
        repositoryName: "payments-api",
        branch: "main",
      },
    ],
    granularity: "day",
    rangeCount: 7,
    ...overrides,
  };
}

function points(counts: (number | null)[]): WorkItemQueryCountPoint[] {
  return counts.map((count, index) => ({
    timestamp: `2026-08-0${index + 1}T00:00:00Z`,
    count,
    error: count === null ? "no snapshot" : null,
  }));
}

function commitResult(count: number): CommitSearchResult {
  return {
    commits: Array.from({ length: count }, (_, index) => ({
      organizationId: "contoso",
      projectId: "proj1",
      projectName: "Payments",
      repositoryId: "repo1",
      repositoryName: "payments-api",
      commitId: `commit${index}`,
      shortCommitId: `abc${index}`,
      comment: `feat: change ${index}`,
      authorName: "Demo User",
      authorEmail: "demo@example.com",
      authorDate: new Date().toISOString(),
      webUrl: null,
    })),
    total: count,
    truncated: false,
  };
}

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnalyzeView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  countWorkItemQueryHistory.mockResolvedValue(points([10, 12, 15]));
  searchCommits.mockResolvedValue(commitResult(3));
  listWorkItemProjects.mockResolvedValue([{ projectId: "proj1", projectName: "Payments" }]);
  listCommitRepositories.mockResolvedValue([
    {
      projectId: "proj1",
      projectName: "Payments",
      repositoryId: "repo1",
      repositoryName: "payments-api",
    },
  ]);
  listRepoBranches.mockResolvedValue([
    { name: "main", isDefault: true },
    { name: "release/2.4", isDefault: false },
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AnalyzeView", () => {
  it("invites the user to add a group when none exist", async () => {
    renderView();
    expect(await screen.findByText(/グループを追加すると/)).toBeTruthy();
  });

  it("shows both queries and branches of the selected group", async () => {
    saveAnalyzeGroups([group()]);
    renderView();

    expect(await screen.findByText("クエリの推移")).toBeTruthy();
    expect(screen.getByText("ブランチのコミット")).toBeTruthy();
    expect(screen.getByText("Bugs — Core")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("15")).toBeTruthy());
  });

  it("renders a branch-only group without a query section", async () => {
    saveAnalyzeGroups([group({ queries: [] })]);
    renderView();

    expect(await screen.findByText("ブランチのコミット")).toBeTruthy();
    expect(screen.queryByText("クエリの推移")).toBeNull();
    expect(countWorkItemQueryHistory).not.toHaveBeenCalled();
  });

  it("renders a query-only group without a branch section", async () => {
    saveAnalyzeGroups([group({ branches: [] })]);
    renderView();

    expect(await screen.findByText("クエリの推移")).toBeTruthy();
    expect(screen.queryByText("ブランチのコミット")).toBeNull();
    expect(searchCommits).not.toHaveBeenCalled();
  });

  it("samples one timestamp per bucket in the window", async () => {
    saveAnalyzeGroups([group({ rangeCount: 7 })]);
    renderView();

    await waitFor(() => expect(countWorkItemQueryHistory).toHaveBeenCalled());
    const input = countWorkItemQueryHistory.mock.calls[0][0];
    expect(input.timestamps).toHaveLength(7);
    expect(input.wiql).toBe("SELECT [System.Id] FROM WorkItems");
  });

  it("opens a query's detail table and returns to the summary", async () => {
    saveAnalyzeGroups([group()]);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Bugs — Core の明細を開く" }));

    expect(await screen.findByText("前期比")).toBeTruthy();
    // The header keeps the group name as a breadcrumb while drilled in.
    expect(screen.getByText(/Payments ›/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "一覧へ" }));
    await waitFor(() => expect(screen.getByText("クエリの推移")).toBeTruthy());
  });

  it("marks a point Azure DevOps could not answer instead of showing zero", async () => {
    countWorkItemQueryHistory.mockResolvedValue(points([10, null, 12]));
    saveAnalyzeGroups([group({ branches: [] })]);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Bugs — Core の明細を開く" }));
    expect(await screen.findByText("no snapshot")).toBeTruthy();
  });

  it("switches granularity and refetches over the new window", async () => {
    saveAnalyzeGroups([group({ branches: [] })]);
    renderView();

    await waitFor(() => expect(countWorkItemQueryHistory).toHaveBeenCalled());
    countWorkItemQueryHistory.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Week" }));

    await waitFor(() => expect(countWorkItemQueryHistory).toHaveBeenCalled());
    // Week defaults to 12 buckets, not the 7 that "day" was showing.
    expect(countWorkItemQueryHistory.mock.calls[0][0].timestamps).toHaveLength(12);
  });

  it("expands the newest buckets that actually have commits", async () => {
    // All commits sit well before the end of the window, so expanding purely by
    // recency would leave the panel showing nothing.
    searchCommits.mockResolvedValue({
      commits: [
        {
          organizationId: "contoso",
          projectId: "proj1",
          projectName: "Payments",
          repositoryId: "repo1",
          repositoryName: "payments-api",
          commitId: "old1",
          shortCommitId: "old1abc",
          comment: "feat: an older change",
          authorName: "Demo User",
          authorEmail: "demo@example.com",
          authorDate: new Date(Date.now() - 5 * 86_400_000).toISOString(),
          webUrl: null,
        },
      ],
      total: 1,
      truncated: false,
    });
    saveAnalyzeGroups([group({ queries: [], rangeCount: 30 })]);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: /main のコミット一覧を開く/ }));
    expect(await screen.findByText("feat: an older change")).toBeTruthy();
  });

  it("moves between groups with the arrow keys", async () => {
    saveAnalyzeGroups([group(), group({ id: "g2", name: "Portal" })]);
    renderView();

    const list = await screen.findByRole("button", { name: /Payments/ });
    fireEvent.keyDown(list, { key: "ArrowDown" });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Portal/ }).getAttribute("aria-current")).toBe(
        "true",
      ),
    );
  });

  it("deletes the selected group with the Delete key", async () => {
    saveAnalyzeGroups([group()]);
    renderView();

    const row = await screen.findByRole("button", { name: /Payments/ });
    fireEvent.keyDown(row, { key: "Delete" });

    await waitFor(() => expect(screen.getByText(/グループを追加すると/)).toBeTruthy());
    expect(window.localStorage.getItem("azdodeck:analyze:groups")).toBe("[]");
  });

  it("opens the editor with N and closes it with Escape", async () => {
    saveAnalyzeGroups([group()]);
    renderView();

    const row = await screen.findByRole("button", { name: /Payments/ });
    fireEvent.keyDown(row, { key: "n" });

    const dialog = await screen.findByRole("dialog");
    // N opens a blank group; E is the one that edits the selected group.
    expect(within(dialog).getByText("グループを追加")).toBeTruthy();

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens the editor for the selected group with E", async () => {
    saveAnalyzeGroups([group()]);
    renderView();

    const row = await screen.findByRole("button", { name: /Payments/ });
    fireEvent.keyDown(row, { key: "e" });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("グループを編集")).toBeTruthy();
    // Pre-filled with the selected group's members rather than a blank form.
    expect(within(dialog).getByText("Bugs — Core")).toBeTruthy();
    expect(within(dialog).getByText("main")).toBeTruthy();
  });

  it("offers the repository's real branches and defaults to its default branch", async () => {
    saveAnalyzeGroups([group()]);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "グループを編集" }));
    const dialog = await screen.findByRole("dialog");

    await waitFor(() => expect(listRepoBranches).toHaveBeenCalled());
    expect(listRepoBranches.mock.calls[0][0]).toMatchObject({
      project: "proj1",
      repository: "repo1",
    });

    const picker = within(dialog).getByRole("combobox", { name: "ブランチ名" });
    fireEvent.mouseDown(picker);
    // Both branches are offered, with the default one marked.
    expect(await within(dialog).findByText("main (default)")).toBeTruthy();
    expect(within(dialog).getByText("release/2.4")).toBeTruthy();
  });

  it("adds the branch chosen from the candidate list", async () => {
    saveAnalyzeGroups([group({ branches: [] })]);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "グループを編集" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(listRepoBranches).toHaveBeenCalled());

    // The picker opens on mousedown, not click.
    fireEvent.mouseDown(within(dialog).getByRole("combobox", { name: "ブランチ名" }));
    // Options commit on pointerdown so the input keeps focus.
    fireEvent.pointerDown(await within(dialog).findByText("release/2.4"));
    fireEvent.click(within(dialog).getByRole("button", { name: "ブランチを追加" }));

    expect(await within(dialog).findByText("release/2.4")).toBeTruthy();
  });

  it("falls back to free text when the branch list cannot be loaded", async () => {
    listRepoBranches.mockRejectedValue(new Error("boom"));
    saveAnalyzeGroups([group({ branches: [] })]);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "グループを編集" }));
    const dialog = await screen.findByRole("dialog");

    // A fetch failure must not block adding a branch the user can name.
    const input = await within(dialog).findByRole("textbox", { name: "ブランチ名" });
    fireEvent.change(input, { target: { value: "hotfix/urgent" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ブランチを追加" }));

    expect(await within(dialog).findByText("hotfix/urgent")).toBeTruthy();
  });

  it("rejects a hand-written WIQL that already carries an ASOF clause", async () => {
    saveAnalyzeGroups([group()]);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "グループを編集" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "WIQL を直接書く" }));
    const textarea = within(dialog).getByPlaceholderText(/SELECT \[System.Id\] FROM WorkItems/);
    fireEvent.change(textarea, {
      target: { value: "SELECT [System.Id] FROM WorkItems ASOF '2026-01-01T00:00:00Z'" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "クエリを追加" }));

    expect(await within(dialog).findByText(/ASOF は Analyze 側で付与する/)).toBeTruthy();
  });
});
