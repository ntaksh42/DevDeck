import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkItemQueryCountPoint } from "@/lib/azdoCommands";
import { AnalyzeView } from "./AnalyzeView";
import { saveAnalyzeGroups, type AnalyzeGroup } from "./analyzeGroupsStorage";

const countWorkItemQueryHistory = vi.fn();
const listWorkItemProjects = vi.fn();

vi.mock("@/lib/azdoCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/azdoCommands")>();
  return {
    ...actual,
    countWorkItemQueryHistory: (...args: unknown[]) => countWorkItemQueryHistory(...args),
    listWorkItemProjects: (...args: unknown[]) => listWorkItemProjects(...args),
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
  listWorkItemProjects.mockResolvedValue([{ projectId: "proj1", projectName: "Payments" }]);
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

  it("shows the queries of the selected group", async () => {
    saveAnalyzeGroups([group()]);
    renderView();

    expect(await screen.findByText("クエリの推移")).toBeTruthy();
    expect(screen.getByText("Bugs — Core")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("15")).toBeTruthy());
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
    saveAnalyzeGroups([group()]);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Bugs — Core の明細を開く" }));
    expect(await screen.findByText("no snapshot")).toBeTruthy();
  });

  it("switches granularity and refetches over the new window", async () => {
    saveAnalyzeGroups([group()]);
    renderView();

    await waitFor(() => expect(countWorkItemQueryHistory).toHaveBeenCalled());
    countWorkItemQueryHistory.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Week" }));

    await waitFor(() => expect(countWorkItemQueryHistory).toHaveBeenCalled());
    // Week defaults to 12 buckets, not the 7 that "day" was showing.
    expect(countWorkItemQueryHistory.mock.calls[0][0].timestamps).toHaveLength(12);
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
