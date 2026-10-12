import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AgentPanelHost } from "@/components/agent/AgentPanelHost";
import { resetAgentPanelState } from "@/components/agent/agentPanelStore";
import { useAgentSubject } from "@/components/agent/agentSubject";
import { openExternalUrl } from "@/lib/openExternal";
import { NotificationsView } from "./NotificationsView";

vi.mock("@/lib/openExternal", () => ({ openExternalUrl: vi.fn() }));

// The view reads the browser demo's seeded notification history (10 rows, 5
// unread) via `listNotifications` / `getUnreadNotificationsCount`.

afterEach(() => {
  cleanup();
});

function renderView(overrides?: {
  onOpenPullRequest?: (query: string, organizationId?: string) => void;
  onOpenView?: (view: "pipelines" | "settings") => void;
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenPullRequest = overrides?.onOpenPullRequest ?? vi.fn();
  const onOpenView = overrides?.onOpenView ?? vi.fn();
  render(
    <QueryClientProvider client={client}>
      <NotificationsView onOpenPullRequest={onOpenPullRequest} onOpenView={onOpenView} />
    </QueryClientProvider>,
  );
  return { onOpenPullRequest, onOpenView };
}

describe("NotificationsView", () => {
  it("shows the seeded notification history", async () => {
    renderView();
    const grid = await screen.findByRole("grid", { name: "Notifications" });
    await waitFor(() => {
      expect(within(grid).getAllByRole("row")).toHaveLength(10);
    });
  });

  it("filters to unread-only notifications", async () => {
    // Other tests in this file mark individual seeded rows read (mutating the
    // shared demo store), so this asserts the filter narrows the list rather
    // than a specific count.
    renderView();
    const grid = await screen.findByRole("grid", { name: "Notifications" });
    await waitFor(() => {
      expect(within(grid).getAllByRole("row")).toHaveLength(10);
    });

    fireEvent.click(screen.getByLabelText("Unread only"));

    await waitFor(() => {
      const count = within(grid).getAllByRole("row").length;
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(10);
    });

    fireEvent.click(screen.getByLabelText("Unread only"));
    await waitFor(() => {
      expect(within(grid).getAllByRole("row")).toHaveLength(10);
    });
  });

  it("moves the selection with j/k and jumps to a pull request on Enter", async () => {
    const { onOpenPullRequest } = renderView();
    const grid = await screen.findByRole("grid", { name: "Notifications" });
    await waitFor(() => {
      expect(within(grid).getAllByRole("row")).toHaveLength(10);
    });
    const rows = within(grid).getAllByRole("row");

    // The newest notification (index 0) is the seeded "prReviewRequested" for
    // PR #42; "j"/"k" roam without leaving the grid.
    fireEvent.keyDown(grid, { key: "j" });
    fireEvent.keyDown(grid, { key: "k" });
    fireEvent.keyDown(rows[0], { key: "Enter" });

    await waitFor(() => {
      expect(onOpenPullRequest).toHaveBeenCalledWith("42", "contoso");
    });
  });

  it("opens the row's webUrl externally on Ctrl+Enter regardless of jump kind", async () => {
    // The newest row resolves to an in-app pull request jump; Ctrl+Enter must
    // still use the row's own webUrl (grid convention), not the jump target.
    const { onOpenPullRequest } = renderView();
    const grid = await screen.findByRole("grid", { name: "Notifications" });
    await waitFor(() => {
      expect(within(grid).getAllByRole("row")).toHaveLength(10);
    });
    const rows = within(grid).getAllByRole("row");

    fireEvent.keyDown(rows[0], { key: "Enter", ctrlKey: true });

    await waitFor(() => {
      expect(openExternalUrl).toHaveBeenCalledWith(
        "https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/pullrequest/42",
      );
    });
    expect(onOpenPullRequest).not.toHaveBeenCalled();
  });

  it("marks the selected row read with r without leaving the view", async () => {
    renderView();
    const grid = await screen.findByRole("grid", { name: "Notifications" });
    await waitFor(() => {
      expect(within(grid).getAllByRole("row")).toHaveLength(10);
    });

    fireEvent.click(screen.getByLabelText("Unread only"));
    let unreadCountBefore = 0;
    await waitFor(() => {
      unreadCountBefore = within(grid).getAllByRole("row").length;
      // Below 10 confirms the filtered fetch resolved (not the pre-filter
      // placeholder data kept on screen while it loads).
      expect(unreadCountBefore).toBeGreaterThan(0);
      expect(unreadCountBefore).toBeLessThan(10);
    });

    const unreadRows = within(grid).getAllByRole("row");
    fireEvent.keyDown(unreadRows[0], { key: "r" });

    // Marking the selected (unread) row read drops it out of the unread-only
    // filter once the list refetches.
    await waitFor(() => {
      expect(within(grid).getAllByRole("row")).toHaveLength(unreadCountBefore - 1);
    });
  });
});

describe("NotificationsView Agent context", () => {
  function Probe() {
    const subject = useAgentSubject();
    return <output data-testid="subject">{subject ? JSON.stringify(subject) : ""}</output>;
  }

  function renderWithAgent() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Probe />
        <NotificationsView onOpenPullRequest={vi.fn()} onOpenView={vi.fn()} />
        <AgentPanelHost />
      </QueryClientProvider>,
    );
  }

  afterEach(() => resetAgentPanelState());

  it("follows the selected notification's PR or work item, and none for a pipeline notification", async () => {
    renderWithAgent();
    const grid = await screen.findByRole("grid", { name: "Notifications" });
    await waitFor(() => expect(within(grid).getAllByRole("row")).toHaveLength(10));
    const subject = () => screen.getByTestId("subject").textContent ?? "";

    // Newest row: review request for PR !42 (the demo payload names the project, not its id).
    await waitFor(() =>
      expect(JSON.parse(subject())).toMatchObject({
        kind: "pull-request",
        id: 42,
        organizationId: "contoso",
        projectId: "Platform",
        repositoryId: "azdo-dashboard",
        repositoryName: "azdo-dashboard",
        // A free-text body has no title line, so the title comes from after the "kind: " prefix.
        title: "Add pull request search dashboard",
      }),
    );
    expect(document.body.textContent).toMatch(/10 items · \d+ unread/);
    fireEvent.keyDown(grid, { key: "j" });
    fireEvent.keyDown(grid, { key: "j" });
    fireEvent.keyDown(grid, { key: "j" });
    await waitFor(() => expect(JSON.parse(subject())).toMatchObject({ kind: "work-item", id: 123 }));
    fireEvent.keyDown(grid, { key: "j" });
    fireEvent.keyDown(grid, { key: "j" });
    fireEvent.keyDown(grid, { key: "j" });
    await waitFor(() => expect(subject()).toBe(""));
  });

  it("shows the Agent drawer by default", async () => {
    resetAgentPanelState();
    renderWithAgent();
    expect(await screen.findByRole("complementary", { name: "Agent" })).toBeTruthy();
  });
});
