import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CommitSummary } from "@/lib/azdoCommands";
import { NAVIGATE_WORK_ITEM_EVENT } from "@/lib/crossLinks";

const listCommitWorkItems = vi.fn();
const getWorkItemPreview = vi.fn();
vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  listCommitWorkItems: (...args: unknown[]) => listCommitWorkItems(...args),
  getWorkItemPreview: (...args: unknown[]) => getWorkItemPreview(...args),
}));

import { CommitLinkedWorkItemsPanel } from "./CommitLinkedWorkItemsPanel";

const commit: CommitSummary = {
  organizationId: "contoso",
  projectId: "p1",
  projectName: "Platform",
  repositoryId: "r1",
  repositoryName: "repo",
  commitId: "abc",
  shortCommitId: "abc",
  comment: "Fix login AB#99",
  authorName: null,
  authorEmail: null,
  authorDate: null,
  webUrl: null,
};

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CommitLinkedWorkItemsPanel commit={commit} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listCommitWorkItems.mockReset();
  getWorkItemPreview.mockReset();
  getWorkItemPreview.mockImplementation(async (input: { workItemId: number }) => ({
    title: `Item ${input.workItemId}`,
    state: "Active",
  }));
});
afterEach(cleanup);

describe("CommitLinkedWorkItemsPanel", () => {
  it("merges linked ids with AB# mentions, shows titles, and opens an item on click", async () => {
    listCommitWorkItems.mockResolvedValue([42]);
    const events: number[] = [];
    window.addEventListener(NAVIGATE_WORK_ITEM_EVENT, ((event: CustomEvent) => {
      events.push(event.detail.workItemId);
    }) as EventListener);
    renderPanel();

    expect(await screen.findByText("2 linked work items")).toBeTruthy();
    expect(await screen.findByText("Item 42")).toBeTruthy();
    expect(await screen.findByText("Item 99")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Open #42 in Work Items"));
    expect(events).toEqual([42]);
  });

  it("renders nothing when there are no links and no mentions", async () => {
    listCommitWorkItems.mockResolvedValue([]);
    const quiet = { ...commit, comment: "Plain message" };
    const { container } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CommitLinkedWorkItemsPanel commit={quiet} />
      </QueryClientProvider>,
    );

    await vi.waitFor(() => expect(listCommitWorkItems).toHaveBeenCalled());
    await vi.waitFor(() => expect(container.textContent).toBe(""));
  });
});
