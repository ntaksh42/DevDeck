import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkItemSummary } from "@/lib/azdoCommands";
import { WorkItemGridRow } from "./WorkItemGridRow";

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

function renderRow(overrides: Partial<WorkItemSummary>) {
  return render(
    <WorkItemGridRow
      item={item(overrides)}
      selected={false}
      checked={false}
      unread={false}
      columnTemplate="32px minmax(0, 1fr)"
      visibleColumns={["title"]}
      extraColumns={[]}
      staleThresholdDays={14}
      rowColorClass={null}
      onSelect={vi.fn()}
      onCheckedChange={vi.fn()}
    />,
  );
}

describe("WorkItemGridRow", () => {
  it("labels draft pull requests separately from active pull requests", () => {
    renderRow({ hasActivePullRequest: true, hasDraftPullRequest: true });

    expect(screen.getByRole("img", { name: "関連PRあり (Active)" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "関連PRあり (Draft)" })).toBeTruthy();
  });
});
