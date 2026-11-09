import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemSummary } from "@/lib/azdoCommands";
import { WiGridHeader } from "./WiGridHeader";
import { useWiGridState } from "./useWiGridState";
import { useWiGridLogic } from "./useWiGridLogic";
import { compareWorkItems, defaultWorkItemSort, loadWorkItemSort } from "./workItemsGridHelpers";
import { normalizeWorkItemQueryView } from "./workItemViewsStorage";

vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/azdoCommands")>(),
  getAppSettings: vi.fn().mockResolvedValue({}),
  getWorkItemPreview: vi.fn().mockResolvedValue(null),
}));

const referenceName = "Microsoft.VSTS.Common.Priority";
const extraColumns = [referenceName];
function item(id: number, value: string | null): WorkItemSummary {
  return {
    organizationId: "org", projectId: "project", projectName: "Project",
    id, title: `Item ${id}`, workItemType: "Task", state: "Active",
    assignedTo: null, changedDate: null, webUrl: null, tags: null, depth: null,
    hasActivePullRequest: false, hasDraftPullRequest: false,
    extraFields: [{ referenceName, value }],
  };
}
const results = [item(1, "10"), item(2, "2"), item(3, null), item(4, "2")];

function Grid() {
  const state = useWiGridState({ extraColumns });
  const logic = useWiGridLogic({ results, loading: false, extraColumns, autoFocus: false }, state);
  return <>
    <WiGridHeader
      displayed={logic.displayed} checkedIds={state.checkedIds}
      setCheckedIds={state.setCheckedIds} setLastCheckedIndex={state.setLastCheckedIndex}
      wiColTemplate={state.wiColTemplate} visibleColumns={state.visibleColumns}
      sort={state.sort} onSort={state.applyWiSort} columnFilters={state.columnFilters}
      onFilterOpen={logic.openFilter} columnResizeProps={state.columnResizeProps}
      extraColumns={extraColumns} extraColumnLabel={() => "Priority"}
    />
    <output data-testid="order">{logic.displayed.map((row) => row.id).join(",")}</output>
  </>;
}
function renderGrid() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <Grid />
  </QueryClientProvider>);
}

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe("extra field column sorting", () => {
  it("sorts numbers in both directions, preserves ties, and restores the saved sort", async () => {
    const grid = renderGrid();
    fireEvent.click(screen.getByRole("button", { name: "Sort by Priority" }));
    expect(screen.getByTestId("order").textContent).toBe("2,4,1,3");
    expect(screen.getByRole("button", { name: "Sort by Priority" }).closest("[role=columnheader]")?.getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(screen.getByRole("button", { name: "Sort by Priority" }));
    expect(screen.getByTestId("order").textContent).toBe("3,1,2,4");
    grid.unmount();
    renderGrid();
    await waitFor(() => expect(screen.getByTestId("order").textContent).toBe("3,1,2,4"));
    expect(screen.getByRole("button", { name: "Sort by Priority" }).closest("[role=columnheader]")?.getAttribute("aria-sort")).toBe("descending");
  });

  it("compares text naturally and finds field references case insensitively", () => {
    expect(compareWorkItems(item(1, "Sprint 2"), item(2, "Sprint 10"), `field:${referenceName.toLowerCase()}`)).toBeLessThan(0);
    expect(compareWorkItems(item(1, "-2.5"), item(2, "1.5"), `field:${referenceName}`)).toBeLessThan(0);
    expect(compareWorkItems(item(1, ""), item(2, null), `field:${referenceName}`)).toBe(0);
  });

  it("keeps field sorting in saved views and rejects malformed sort keys", () => {
    const base = { id: "view", name: "View", projectId: "project", wiql: "SELECT [System.Id] FROM WorkItems" };
    const sortKey = `field:${referenceName}`;
    expect(normalizeWorkItemQueryView({ ...base, sortKey, sortDirection: "asc" })?.sortKey).toBe(sortKey);
    for (const key of ["field:", "field:bad", "unknown"]) {
      expect(normalizeWorkItemQueryView({ ...base, sortKey: key })?.sortKey).toBe("changedDate");
      localStorage.setItem("sort-test", JSON.stringify({ key, direction: "asc" }));
      expect(loadWorkItemSort("sort-test", defaultWorkItemSort())).toEqual(defaultWorkItemSort());
    }
  });
});
