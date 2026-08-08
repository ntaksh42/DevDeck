import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  CommitSearchResult,
  WorkItemQueryCountPoint,
  WorkItemSummary,
} from "@/lib/azdoCommands";
import { AnalyzeView } from "./AnalyzeView";
import { loadAnalyzeGroups, saveAnalyzeGroups, type AnalyzeGroup } from "./analyzeGroupsStorage";

const countWorkItemQueryHistory = vi.fn();
const runWorkItemQuery = vi.fn();
const searchCommits = vi.fn();
const listWorkItemProjects = vi.fn();
const listCommitRepositories = vi.fn();
const listRepoBranches = vi.fn();

vi.mock("@/lib/azdoCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/azdoCommands")>();
  return {
    ...actual,
    countWorkItemQueryHistory: (...args: unknown[]) => countWorkItemQueryHistory(...args),
    runWorkItemQuery: (...args: unknown[]) => runWorkItemQuery(...args),
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
      {
        id: "q1",
        name: "Bugs — Core",
        projectId: "",
        wiql: "SELECT [System.Id] FROM WorkItems",
        milestones: [],
      },
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
    rangePreset: "count",
    rangeFrom: "",
    rangeTo: "",
    breakdownAxis: "assignedTo",
    ...overrides,
  };
}

function points(counts: (number | null)[], offset = 0): WorkItemQueryCountPoint[] {
  return counts.map((count, index) => ({
    timestamp: `2026-08-${String(offset + index + 1).padStart(2, "0")}T00:00:00Z`,
    count,
    error: count === null ? "no snapshot" : null,
  }));
}

function workItem(overrides: Partial<WorkItemSummary> = {}): WorkItemSummary {
  return {
    organizationId: "contoso",
    projectId: "proj1",
    projectName: "Payments",
    id: 1,
    title: "Something broke",
    workItemType: "Bug",
    state: "Active",
    assignedTo: "Alice Johnson",
    changedDate: null,
    webUrl: null,
    tags: null,
    extraFields: [],
    depth: null,
    ...overrides,
  };
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

function renderView(client?: QueryClient) {
  const queryClient =
    client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AnalyzeView />
    </QueryClientProvider>,
  );
}

/**
 * The hook splits a series into a cached "settled" request and a live "open"
 * one for the trailing bucket, so a mock has to answer per-request rather than
 * returning the whole series twice.
 */
function mockHistory(counts: (number | null)[]): void {
  countWorkItemQueryHistory.mockImplementation((input: { timestamps: string[] }) => {
    const requested = input.timestamps.length;
    // The open request always asks for the single trailing point.
    return requested === 1
      ? Promise.resolve(points(counts.slice(-1), counts.length - 1))
      : Promise.resolve(points(counts.slice(0, requested)));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  mockHistory([10, 12, 15]);
  runWorkItemQuery.mockResolvedValue([]);
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
    expect(screen.getAllByText("Bugs — Core").length).toBeGreaterThan(0);
    // The latest count reaches both the chart legend and the summary row.
    await waitFor(() => expect(screen.getAllByText("15").length).toBeGreaterThan(0));
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

    await waitFor(() => expect(countWorkItemQueryHistory.mock.calls.length).toBe(2));
    // The settled points and the trailing open one are fetched separately so
    // the closed half can be cached, but together they still cover the window.
    const totals = countWorkItemQueryHistory.mock.calls
      .map((call) => call[0].timestamps.length)
      .sort((a, b) => a - b);
    expect(totals).toEqual([1, 6]);
    expect(countWorkItemQueryHistory.mock.calls[0][0].wiql).toBe(
      "SELECT [System.Id] FROM WorkItems",
    );
  });

  it("caches the settled points and only refetches the open one", async () => {
    saveAnalyzeGroups([group({ branches: [], rangeCount: 7 })]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = renderView(client);

    await waitFor(() => expect(countWorkItemQueryHistory.mock.calls.length).toBe(2));
    const settledCalls = () =>
      countWorkItemQueryHistory.mock.calls.filter((call) => call[0].timestamps.length > 1);
    expect(settledCalls()).toHaveLength(1);

    // Remounting against the same cache must not re-ask for the closed points,
    // which is the whole point of splitting the request.
    unmount();
    renderView(client);
    await waitFor(() => expect(screen.getByText("クエリの推移")).toBeTruthy());
    expect(settledCalls()).toHaveLength(1);
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

  it("waits for both halves before plotting, so the newest point keeps its slot", async () => {
    let releaseSettled: (value: WorkItemQueryCountPoint[]) => void = () => {};
    countWorkItemQueryHistory.mockImplementation((input: { timestamps: string[] }) => {
      if (input.timestamps.length === 1) return Promise.resolve(points([15], 6));
      // Hold the settled half open so only the trailing point has resolved.
      return new Promise<WorkItemQueryCountPoint[]>((resolve) => {
        releaseSettled = resolve;
      });
    });

    saveAnalyzeGroups([group({ branches: [], rangeCount: 7 })]);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Bugs — Core の明細を開く" }));
    // With only the open half in hand the series must stay empty rather than
    // rendering 15 as though it were the oldest bucket.
    expect(screen.queryByText("15")).toBeNull();

    releaseSettled(points([30, 28, 26, 24, 22, 20]));
    await waitFor(() => expect(screen.getAllByText("15").length).toBeGreaterThan(0));
  });

  it("marks a point Azure DevOps could not answer instead of showing zero", async () => {
    mockHistory([10, null, 12]);
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

    // Week defaults to 12 buckets, not the 7 that "day" was showing, so the
    // settled half now asks for 11. The trailing point is always sampled at
    // "now", so its key is unchanged and it stays served from cache.
    await waitFor(() =>
      expect(countWorkItemQueryHistory.mock.calls.map((call) => call[0].timestamps.length)).toEqual(
        [11],
      ),
    );
  });

  it("switches to the month granularity", async () => {
    saveAnalyzeGroups([group({ branches: [] })]);
    renderView();

    await waitFor(() => expect(countWorkItemQueryHistory).toHaveBeenCalled());
    countWorkItemQueryHistory.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Month" }));

    // Month defaults to 6 buckets, so 5 settled points.
    await waitFor(() =>
      expect(countWorkItemQueryHistory.mock.calls.map((call) => call[0].timestamps.length)).toEqual(
        [5],
      ),
    );
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

    fireEvent.click(await screen.findByRole("button", { name: /main の明細を開く/ }));
    expect(await screen.findByText("feat: an older change")).toBeTruthy();
  });

  it("shows the current breakdown by assignee on the breakdown tab", async () => {
    runWorkItemQuery.mockResolvedValue([
      workItem({ id: 1, assignedTo: "Alice Johnson" }),
      workItem({ id: 2, assignedTo: "Alice Johnson" }),
      workItem({ id: 3, assignedTo: "Bob Tanaka" }),
      workItem({ id: 4, assignedTo: null }),
    ]);
    saveAnalyzeGroups([group({ branches: [] })]);
    renderView();

    // The breakdown pulls whole rows, so it must not fetch until asked for.
    await waitFor(() => expect(countWorkItemQueryHistory).toHaveBeenCalled());
    expect(runWorkItemQuery).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("tab", { name: "内訳" }));

    const list = await screen.findByRole("list", { name: "担当者別の内訳" });
    const rows = within(list).getAllByRole("listitem");
    // Largest first, with unassigned gathered into its own row.
    expect(rows[0].textContent).toContain("Alice Johnson");
    expect(rows[0].textContent).toContain("2");
    expect(rows[0].textContent).toContain("50%");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Alice Johnson"),
      expect.stringContaining("Bob Tanaka"),
      expect.stringContaining("未割当"),
    ]);
  });

  it("moves down the breakdown rows with the arrow keys", async () => {
    runWorkItemQuery.mockResolvedValue([
      workItem({ id: 1, assignedTo: "Alice Johnson" }),
      workItem({ id: 2, assignedTo: "Bob Tanaka" }),
    ]);
    saveAnalyzeGroups([group({ branches: [] })]);
    renderView();

    fireEvent.click(await screen.findByRole("tab", { name: "内訳" }));
    const list = await screen.findByRole("list", { name: "担当者別の内訳" });

    // The first row starts current; the arrow key moves that marker down.
    await waitFor(() =>
      expect(within(list).getAllByRole("listitem")[0].getAttribute("aria-current")).toBe("true"),
    );
    fireEvent.keyDown(list, { key: "ArrowDown" });
    await waitFor(() =>
      expect(within(list).getAllByRole("listitem")[1].getAttribute("aria-current")).toBe("true"),
    );
  });

  it("regroups the breakdown by state when the axis is switched", async () => {
    runWorkItemQuery.mockResolvedValue([
      workItem({ id: 1, state: "Active", assignedTo: "Alice Johnson" }),
      workItem({ id: 2, state: "Active", assignedTo: "Bob Tanaka" }),
      workItem({ id: 3, state: "Blocked", assignedTo: "Alice Johnson" }),
    ]);
    saveAnalyzeGroups([group({ branches: [] })]);
    renderView();

    fireEvent.click(await screen.findByRole("tab", { name: "内訳" }));
    await screen.findByRole("list", { name: "担当者別の内訳" });

    fireEvent.change(screen.getByLabelText("集計軸"), { target: { value: "state" } });

    // The same items now split by state rather than by who holds them.
    const list = await screen.findByRole("list", { name: "状態別の内訳" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Active"),
      expect.stringContaining("Blocked"),
    ]);
    expect(rows[0].textContent).toContain("2");
  });

  it("groups the breakdown by work item type", async () => {
    runWorkItemQuery.mockResolvedValue([
      workItem({ id: 1, workItemType: "Bug" }),
      workItem({ id: 2, workItemType: "Task" }),
      workItem({ id: 3, workItemType: "Bug" }),
    ]);
    saveAnalyzeGroups([group({ branches: [] })]);
    renderView();

    fireEvent.click(await screen.findByRole("tab", { name: "内訳" }));
    fireEvent.change(await screen.findByLabelText("集計軸"), {
      target: { value: "workItemType" },
    });

    const list = await screen.findByRole("list", { name: "種別別の内訳" });
    expect(within(list).getAllByRole("listitem")[0].textContent).toContain("Bug");
  });

  it("remembers the breakdown axis per group", async () => {
    runWorkItemQuery.mockResolvedValue([workItem({ id: 1, state: "Active" })]);
    saveAnalyzeGroups([group(), group({ id: "g2", name: "Portal" })]);
    renderView();

    fireEvent.click(await screen.findByRole("tab", { name: "内訳" }));
    fireEvent.change(await screen.findByLabelText("集計軸"), { target: { value: "state" } });
    await screen.findByRole("list", { name: "状態別の内訳" });

    // The axis belongs to the group, so it survives being stored and reloaded.
    const stored = JSON.parse(window.localStorage.getItem("azdodeck:analyze:groups")!);
    expect(stored[0].breakdownAxis).toBe("state");
    expect(stored[1].breakdownAxis).toBe("assignedTo");

    // Switching to the other group shows its own axis, not the one just chosen.
    fireEvent.click(screen.getByRole("button", { name: /Portal/ }));
    fireEvent.click(await screen.findByRole("tab", { name: "内訳" }));
    expect(await screen.findByRole("list", { name: "担当者別の内訳" })).toBeTruthy();
  });

  it("defaults a group saved before the axis existed to the assignee view", () => {
    // Groups written by an older build have no breakdownAxis at all.
    window.localStorage.setItem(
      "azdodeck:analyze:groups",
      JSON.stringify([{ ...group(), breakdownAxis: undefined }]),
    );
    const [restored] = loadAnalyzeGroups();
    expect(restored.breakdownAxis).toBe("assignedTo");
  });

  it("warns when the breakdown is built from a truncated result", async () => {
    runWorkItemQuery.mockResolvedValue(
      Array.from({ length: 500 }, (_, index) =>
        workItem({ id: index, assignedTo: `Person ${index % 3}` }),
      ),
    );
    saveAnalyzeGroups([group({ branches: [] })]);
    renderView();

    fireEvent.click(await screen.findByRole("tab", { name: "内訳" }));
    expect(await screen.findByText(/取得上限に達したため/)).toBeTruthy();
  });

  it("asks for a query before it can show a breakdown", async () => {
    saveAnalyzeGroups([group({ queries: [] })]);
    renderView();

    fireEvent.click(await screen.findByRole("tab", { name: "内訳" }));
    expect(await screen.findByText(/内訳を出すにはグループにクエリを登録/)).toBeTruthy();
    expect(runWorkItemQuery).not.toHaveBeenCalled();
  });

  it("hides a series from the chart when its legend entry is toggled off", async () => {
    saveAnalyzeGroups([group({ branches: [] })]);
    renderView();

    await screen.findByRole("group", { name: "系列の表示" });
    const entry = () =>
      within(screen.getByRole("group", { name: "系列の表示" })).getByRole("button", {
        name: /Bugs — Core/,
      });
    expect(entry().getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(entry());
    await waitFor(() => expect(entry().getAttribute("aria-pressed")).toBe("false"));

    // Toggling back restores it rather than dropping the member.
    fireEvent.click(entry());
    await waitFor(() => expect(entry().getAttribute("aria-pressed")).toBe("true"));
  });

  it("moves the shared cursor with the arrow keys, without a pointer", async () => {
    mockHistory([30, 28, 26, 24, 22, 20, 15]);
    saveAnalyzeGroups([group({ branches: [], rangeCount: 7 })]);
    renderView();

    const chart = await screen.findByRole("img", { name: /重ねたチャート/ });
    // Wait for the series to arrive so the cursor lands on real values.
    await waitFor(() => expect(screen.getAllByText("15").length).toBeGreaterThan(0));

    // Entering from the keyboard starts at the newest bucket, so stepping left
    // reads the one before it rather than the far end of the window.
    fireEvent.keyDown(chart, { key: "ArrowLeft" });

    // The tooltip is the only place the previous bucket's 20 is reported.
    await waitFor(() => expect(screen.getAllByText("20").length).toBeGreaterThan(0));

    // Escape clears it again, leaving no cursor reading behind.
    fireEvent.keyDown(chart, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: /重ねたチャート/ }).getAttribute("aria-label"),
      ).not.toContain("現在"),
    );
  });

  it("names the commits behind the bucket the cursor sits on", async () => {
    // All commits land today, so the cursor's last bucket holds them.
    searchCommits.mockResolvedValue({
      commits: [
        {
          organizationId: "contoso",
          projectId: "proj1",
          projectName: "Payments",
          repositoryId: "repo1",
          repositoryName: "payments-api",
          commitId: "c1",
          shortCommitId: "a3f91c",
          comment: "fix: 認証リトライの修正\n\n詳細は本文",
          authorName: "Demo User",
          authorEmail: "demo@example.com",
          authorDate: new Date().toISOString(),
          webUrl: null,
        },
      ],
      total: 1,
      truncated: false,
    });
    saveAnalyzeGroups([group({ queries: [], rangeCount: 7 })]);
    renderView();

    const chart = await screen.findByRole("img", { name: /重ねたチャート/ });
    fireEvent.keyDown(chart, { key: "End" });

    // The subject line only, taken from data the bars already used.
    expect(await screen.findByText("fix: 認証リトライの修正")).toBeTruthy();
    expect(screen.getByText("a3f91c")).toBeTruthy();
    expect(screen.getByText(/この期間のコミット/)).toBeTruthy();
  });

  it("leaves a hidden branch's commits out of the tooltip", async () => {
    saveAnalyzeGroups([group({ queries: [], rangeCount: 7 })]);
    renderView();

    const legend = await screen.findByRole("group", { name: "系列の表示" });
    const chart = screen.getByRole("img", { name: /重ねたチャート/ });
    fireEvent.keyDown(chart, { key: "End" });
    expect(await screen.findByText(/この期間のコミット/)).toBeTruthy();

    // Hiding the series must also retract what the tooltip claims about it.
    fireEvent.click(within(legend).getByRole("button", { name: /main/ }));
    await waitFor(() => expect(screen.queryByText(/この期間のコミット/)).toBeNull());
  });

  it("omits the commit section for a bucket with no commits", async () => {
    searchCommits.mockResolvedValue({ commits: [], total: 0, truncated: false });
    saveAnalyzeGroups([group({ queries: [], rangeCount: 7 })]);
    renderView();

    const chart = await screen.findByRole("img", { name: /重ねたチャート/ });
    fireEvent.keyDown(chart, { key: "End" });

    // An empty heading would be worse than no heading.
    await waitFor(() => expect(screen.queryByText(/この期間のコミット/)).toBeNull());
  });

  it("keeps chart arrow keys from also moving the summary rows", async () => {
    saveAnalyzeGroups([group({ rangeCount: 7 })]);
    renderView();

    const chart = await screen.findByRole("img", { name: /重ねたチャート/ });
    const firstRow = screen.getByRole("button", { name: "Bugs — Core の明細を開く" });
    firstRow.focus();

    // The chart owns the arrow keys while it is focused; the roving tabindex in
    // the summary list must not advance at the same time.
    fireEvent.keyDown(chart, { key: "ArrowDown" });
    fireEvent.keyDown(chart, { key: "ArrowRight" });

    expect(document.activeElement).toBe(firstRow);
  });

  it("announces the cursor position for screen readers", async () => {
    saveAnalyzeGroups([group({ branches: [], rangeCount: 7 })]);
    renderView();

    const chart = await screen.findByRole("img", { name: /重ねたチャート/ });
    expect(chart.getAttribute("aria-label")).toContain("矢印キーで期間を移動");

    fireEvent.keyDown(chart, { key: "End" });
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: /重ねたチャート/ }).getAttribute("aria-label"),
      ).toContain("現在"),
    );
  });

  it("moves between summary rows with the arrow keys", async () => {
    saveAnalyzeGroups([group()]);
    renderView();

    const queryRow = await screen.findByRole("button", { name: "Bugs — Core の明細を開く" });
    queryRow.focus();
    fireEvent.keyDown(queryRow, { key: "ArrowDown" });

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "main の明細を開く" }),
      ),
    );
  });

  it("shows the view's shortcuts so they can be discovered", async () => {
    saveAnalyzeGroups([group()]);
    renderView();

    expect(await screen.findByText("D / W / M")).toBeTruthy();
    expect(screen.getByText("[ / ]")).toBeTruthy();
  });

  it("widens the counted window with the ] key", async () => {
    saveAnalyzeGroups([group({ branches: [], rangeCount: 7 })]);
    renderView();

    await waitFor(() => expect(countWorkItemQueryHistory).toHaveBeenCalled());
    countWorkItemQueryHistory.mockClear();

    fireEvent.click(await screen.findByRole("button", { name: "Bugs — Core の明細を開く" }));
    fireEvent.click(screen.getByRole("button", { name: "一覧へ" }));
    fireEvent.keyDown(screen.getByText("クエリの推移").closest("div")!, { key: "]" });

    // 7 days steps up to the next option, 30, so 29 settled points.
    await waitFor(() =>
      expect(countWorkItemQueryHistory.mock.calls.map((call) => call[0].timestamps.length)).toContain(
        29,
      ),
    );
  });

  it("switches to a custom date range", async () => {
    saveAnalyzeGroups([group({ branches: [] })]);
    renderView();

    fireEvent.change(await screen.findByLabelText("期間の種類"), {
      target: { value: "custom" },
    });

    fireEvent.change(await screen.findByLabelText("開始日"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(screen.getByLabelText("終了日"), { target: { value: "2026-07-10" } });

    await waitFor(() => expect(screen.getByText("2026-07-01 – 2026-07-10")).toBeTruthy());
  });

  it("adds and removes a milestone on a query", async () => {
    saveAnalyzeGroups([group({ branches: [] })]);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Bugs — Core の明細を開く" }));
    expect(await screen.findByText(/その日までに何件にするか/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "マイルストーンを追加" }));
    expect(await screen.findByLabelText("MS1 の日付")).toBeTruthy();

    // The target survives a reload because it is stored on the member.
    const stored = JSON.parse(window.localStorage.getItem("azdodeck:analyze:groups")!);
    expect(stored[0].queries[0].milestones).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "MS1 を削除" }));
    await waitFor(() => expect(screen.queryByLabelText("MS1 の日付")).toBeNull());
  });

  it("judges a past milestone against the actual on that day", async () => {
    const today = new Date().toISOString().slice(0, 10);
    // One count per bucket so the trailing point lines up with today.
    mockHistory([30, 28, 26, 24, 22, 20, 15]);
    saveAnalyzeGroups([
      group({
        branches: [],
        rangeCount: 7,
        queries: [
          {
            id: "q1",
            name: "Bugs — Core",
            projectId: "",
            wiql: "SELECT [System.Id] FROM WorkItems",
            // Today's actual is 15, so a target of 5 is missed.
            milestones: [{ date: today, count: 5 }],
          },
        ],
      }),
    ]);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Bugs — Core の明細を開く" }));
    expect(await screen.findByText("未達")).toBeTruthy();
    expect(screen.getByText(/実績 15 \/ 目標 5/)).toBeTruthy();
  });

  it("exports the stored groups as a JSON download", async () => {
    const click = vi.fn();
    const createObjectURL = vi.fn(() => "blob:analyze");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = createElement(tag);
      if (tag === "a") element.click = click;
      return element;
    });

    saveAnalyzeGroups([group()]);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "書き出し" }));

    expect(click).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalled();
    expect(await screen.findByText("1 件のグループを書き出しました。")).toBeTruthy();

    vi.unstubAllGlobals();
    vi.mocked(document.createElement).mockRestore();
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
