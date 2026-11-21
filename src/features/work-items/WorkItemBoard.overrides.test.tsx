import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkItemSummary } from "@/lib/azdoCommands";
import { WorkItemBoard } from "./WorkItemBoard";

vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  listWorkItemTypeStates: vi.fn(async () => ["New", "Active", "Resolved"]),
  setWorkItemsState: vi.fn(async () => [{ id: 1, error: null }]),
}));

afterEach(cleanup);

function item(state: string): WorkItemSummary {
  return {
    organizationId: "org",
    projectId: "proj",
    projectName: "Proj",
    id: 1,
    title: "Item 1",
    workItemType: "Bug",
    state,
    assignedTo: null,
    changedDate: null,
    webUrl: null,
    tags: null,
    extraFields: [],
    depth: null,
    hasActivePullRequest: false,
    hasDraftPullRequest: false,
  };
}

describe("WorkItemBoard", () => {
  it("shows the refetched state once a move has been saved", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const board = (results: WorkItemSummary[]) => (
      <QueryClientProvider client={client}>
        <WorkItemBoard organizationId="org" projectId="proj" results={results} />
      </QueryClientProvider>
    );
    const { rerender } = render(board([item("New")]));
    const group = await screen.findByRole("group", { name: /Work item board/ });
    await screen.findByRole("listbox", { name: "New (1)" });

    fireEvent.keyDown(group, { key: "ArrowRight", shiftKey: true });
    await screen.findByRole("listbox", { name: "Active (1)" });

    // Later changed elsewhere (e.g. in the preview); the refetch says Resolved.
    rerender(board([item("Resolved")]));
    await waitFor(() => expect(screen.getByRole("listbox", { name: "Resolved (1)" })).toBeTruthy());
  });
});
