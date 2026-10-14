import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkItemQueryCountPoint } from "@/lib/azdoCommands";
import { AnalyzeView } from "./AnalyzeView";
import { saveAnalyzeGroups, type AnalyzeGroup } from "./analyzeGroupsStorage";
import { useAgentSubject } from "@/components/agent/agentSubject";
import { buildContextDocument } from "@/components/agent/contextDocument";

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

function SubjectProbe() {
  const subject = useAgentSubject();
  return <output data-testid="agent-subject">{subject ? `${subject.kind}:${subject.title}` : ""}</output>;
}

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnalyzeView />
      <SubjectProbe />
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
    expect(await screen.findByText(/Add a group to track/)).toBeTruthy();
  });

  it("shows the queries of the selected group", async () => {
    saveAnalyzeGroups([group()]);
    renderView();

    expect(await screen.findByText("Query trends")).toBeTruthy();
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

    fireEvent.click(await screen.findByRole("button", { name: "Open details for Bugs — Core" }));

    expect(await screen.findByText("Change")).toBeTruthy();
    // The header keeps the group name as a breadcrumb while drilled in.
    expect(screen.getByText(/Payments ›/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back to list" }));
    await waitFor(() => expect(screen.getByText("Query trends")).toBeTruthy());
  });

  it("marks a point Azure DevOps could not answer instead of showing zero", async () => {
    countWorkItemQueryHistory.mockResolvedValue(points([10, null, 12]));
    saveAnalyzeGroups([group()]);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Open details for Bugs — Core" }));
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

  it("leaves Ctrl / Alt chords to the app instead of moving the selection", async () => {
    saveAnalyzeGroups([group(), group({ id: "g2", name: "Portal" })]);
    renderView();

    const row = await screen.findByRole("button", { name: /Payments/ });
    const event = createEvent.keyDown(row, { key: "k", ctrlKey: true });
    fireEvent(row, event);

    expect(event.defaultPrevented).toBe(false);
    expect(row.getAttribute("aria-current")).toBe("true");
  });

  it("deletes the selected group with the Delete key", async () => {
    saveAnalyzeGroups([group()]);
    renderView();

    const row = await screen.findByRole("button", { name: /Payments/ });
    fireEvent.keyDown(row, { key: "Delete" });

    await waitFor(() => expect(screen.getByText(/Add a group to track/)).toBeTruthy());
    expect(window.localStorage.getItem("azdodeck:analyze:groups")).toBe("[]");
  });

  it("opens the editor with N and closes it with Escape", async () => {
    saveAnalyzeGroups([group()]);
    renderView();

    const row = await screen.findByRole("button", { name: /Payments/ });
    fireEvent.keyDown(row, { key: "n" });

    const dialog = await screen.findByRole("dialog");
    // N opens a blank group; E is the one that edits the selected group.
    expect(within(dialog).getByText("Add group")).toBeTruthy();

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens the editor with N on the empty list and returns focus on Escape", async () => {
    renderView();

    await screen.findByText("No groups yet.");
    const list = document.querySelector<HTMLElement>('[data-primary-grid="true"]')!;
    list.focus();
    fireEvent.keyDown(list, { key: "n" });

    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(list));
  });

  it("opens the editor for the selected group with E", async () => {
    saveAnalyzeGroups([group()]);
    renderView();

    const row = await screen.findByRole("button", { name: /Payments/ });
    fireEvent.keyDown(row, { key: "e" });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Edit group")).toBeTruthy();
    // Pre-filled with the selected group's members rather than a blank form.
    expect(within(dialog).getByText("Bugs — Core")).toBeTruthy();
  });

  it("rejects a hand-written WIQL that already carries an ASOF clause", async () => {
    saveAnalyzeGroups([group()]);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Edit group" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Write WIQL" }));
    const textarea = within(dialog).getByPlaceholderText(/SELECT \[System.Id\] FROM WorkItems/);
    fireEvent.change(textarea, {
      target: { value: "SELECT [System.Id] FROM WorkItems ASOF '2026-01-01T00:00:00Z'" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add query" }));

    expect(await within(dialog).findByText(/Analyze adds ASOF itself/)).toBeTruthy();
  });

  it("counts the groups in the list's status bar", async () => {
    saveAnalyzeGroups([group(), group({ id: "g2", name: "Portal" })]);
    renderView();

    expect(await screen.findByText("2 items")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show keyboard shortcuts for this view" })).toBeTruthy();
  });

  it("publishes the selected group to the Agent panel with its numbers", async () => {
    saveAnalyzeGroups([group()]);
    renderView();

    await waitFor(() =>
      expect(screen.getByTestId("agent-subject").textContent).toBe("analyze-group:Payments"),
    );
    await waitFor(() => expect(screen.getByText("15")).toBeTruthy());

    const document = await buildContextDocument({
      kind: "analyze-group",
      id: "g1",
      title: "Payments",
      webUrl: null,
    });
    expect(document).toContain("# Analyze group: Payments");
    expect(document).toContain("### Bugs — Core");
    expect(document).toContain("SELECT [System.Id] FROM WorkItems");
    expect(document).toMatch(/\| 10 \|[\s\S]*\| 12 \|[\s\S]*\| 15 \|/);
  });
});
