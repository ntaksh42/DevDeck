import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { WorkItemSummary } from "@/lib/azdoCommands";
import { WorkItemGridRow } from "./WorkItemGridRow";
import type { WiSortKey } from "./workItemsGridHelpers";

function item(overrides: Partial<WorkItemSummary> = {}): WorkItemSummary {
  return {
    organizationId: "org",
    projectId: "project",
    projectName: "Project",
    id: 42,
    title: "Fix the dashboard",
    workItemType: "Bug",
    state: "Active",
    assignedTo: null,
    changedDate: null,
    webUrl: null,
    tags: null,
    extraFields: [],
    depth: null,
    hasActivePullRequest: false,
    hasDraftPullRequest: false,
    ...overrides,
  };
}

function renderRow(overrides: Partial<WorkItemSummary>, columns: WiSortKey[] = ["title"]) {
  // The row shows an agent-notes badge backed by a query.
  return render(
    <QueryClientProvider client={new QueryClient()}>
    <WorkItemGridRow
      item={item(overrides)}
      selected={false}
      checked={false}
      unread={false}
      columnTemplate="32px minmax(0, 1fr)"
      visibleColumns={columns}
      extraColumns={[]}
      staleThresholdDays={14}
      rowColorClass={null}
      onSelect={vi.fn()}
      onCheckedChange={vi.fn()}
    />
    </QueryClientProvider>,
  );
}

describe("WorkItemGridRow", () => {
  it("labels draft pull requests separately from active pull requests", () => {
    renderRow({ hasActivePullRequest: true, hasDraftPullRequest: true });

    expect(screen.getByRole("img", { name: "関連PRあり (Active)" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "関連PRあり (Draft)" })).toBeTruthy();
  });

  it("renders the state column as a colored pill", () => {
    const { container } = renderRow({ state: "Resolved" }, ["state"]);

    expect(screen.getByText("Resolved")).toBeTruthy();
    expect(container.querySelector(".bg-amber-500")).toBeTruthy();
  });
});
