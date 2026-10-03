import { type ReactNode, useRef, useState } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommitSummary, ReviewPullRequestSummary, WorkItemSummary } from "./azdoCommands";
import { useKeyedGridSelection } from "./useKeyedGridSelection";
import { useMyReviewsSelectionState } from "@/features/pull-requests/useMyReviewsSelectionState";
import { useWiGridState } from "@/features/work-items/useWiGridState";
import { useWiGridLogic } from "@/features/work-items/useWiGridLogic";
import { CommitResults } from "@/features/commits/CommitResults";

const openExternalUrl = vi.hoisted(() => vi.fn());
vi.mock("./openExternal", () => ({ openExternalUrl }));
vi.mock("@/components/DockableWorkspace", () => ({
  DockableWorkspace: ({ panels }: { panels: { id: string; content: ReactNode }[] }) =>
    <>{panels.map((panel) => <div key={panel.id}>{panel.content}</div>)}</>,
}));
vi.mock("@/features/commits/CommitPreviewPanel", () => ({
  CommitPreviewPanel: ({ commit }: { commit: CommitSummary | null }) =>
    <div data-testid="commit-preview">{commit?.commitId}</div>,
}));

const common = {
  organizationId: "org", projectId: "project", projectName: "Project",
  repositoryId: "repo", repositoryName: "Repo", webUrl: "https://example.test/item",
};
const prs: ReviewPullRequestSummary[] = [1, 2, 3].map((id) => ({
  ...common, pullRequestId: id, title: `PR ${id}`, createdBy: null,
  creationDate: "2026-01-01", targetRefName: "refs/heads/main", myVote: 0,
  myVoteLabel: "No vote", myIsRequired: false, isDraft: false,
  mergeStatus: null, ciStatus: null, ciContext: null, ciCheckCount: 0,
}));
const items: WorkItemSummary[] = [1, 2, 3].map((id) => ({
  ...common, id, title: `Item ${id}`, workItemType: "Task", state: id === 3 ? "Closed" : "Active",
  assignedTo: null, changedDate: null, tags: null, extraFields: [], depth: null,
  hasActivePullRequest: false, hasDraftPullRequest: false,
}));
const commits: CommitSummary[] = [1, 2, 3].map((id) => ({
  ...common, commitId: `sha${id}`, shortCommitId: `sha${id}`, comment: `Commit ${id}`,
  authorName: null, authorEmail: null, authorDate: `2026-01-0${4 - id}`,
  webUrl: `https://example.test/commit/${id}`,
}));

function wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => { localStorage.clear(); openExternalUrl.mockClear(); });
afterEach(cleanup);

describe("My Reviews focused selection", () => {
  function setup() {
    return renderHook(({ rows, visible }: { rows: ReviewPullRequestSummary[]; visible: number[] }) => {
      const containerRef = useRef<HTMLDivElement>(null);
      const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
      const [returnedKeys, setReturnedKeys] = useState(new Set<string>());
      return useMyReviewsSelectionState({
        sortedPrs: rows, visibleSortedIndexes: visible, prFlatIndexes: visible,
        scrollerEl: null, containerRef, rowRefs, returnedKeys, setReturnedKeys,
        resultKeysSignature: rows.map((pr) => pr.pullRequestId).join("|"),
        organizationId: "org", selectRequest: null, onSelectRequestHandled: undefined,
        onClearForSelectRequest: () => {},
      });
    }, { initialProps: { rows: prs, visible: [0, 1, 2] }, wrapper });
  }
  it("keeps the selected PR when rows are inserted, removed above it, or reordered", () => {
    const { result, rerender } = setup();
    act(() => result.current.setSelectedIndex(1));
    const inserted = { ...prs[0], pullRequestId: 4 };
    rerender({ rows: [inserted, ...prs], visible: [0, 1, 2, 3] });
    expect(result.current.selectedPr?.pullRequestId).toBe(2);
    expect(result.current.selectedIndex).toBe(2);
    rerender({ rows: [prs[2], prs[1]], visible: [0, 1] });
    expect(result.current.selectedPr?.pullRequestId).toBe(2);
    expect(result.current.selectedPrs[0].pullRequestId).toBe(2);
  });
  it("falls back to a nearby visible row on collapse and clears an empty grid", () => {
    const { result, rerender } = setup();
    act(() => result.current.setSelectedIndex(1));
    rerender({ rows: prs, visible: [0, 2] });
    expect(result.current.selectedPr?.pullRequestId).toBe(3);
    rerender({ rows: prs, visible: [] });
    expect(result.current.selectedPr).toBeNull();
    expect(result.current.selectedIndex).toBe(-1);
    expect(result.current.selectedPrs).toEqual([]);
  });
});

describe("Work Items focused selection", () => {
  function setup() {
    return renderHook(({ rows }: { rows: WorkItemSummary[] }) => {
      const state = useWiGridState({ extraColumns: [], initialSort: { key: "id", direction: "asc" } });
      const logic = useWiGridLogic({ results: rows, loading: false, autoFocus: false }, state);
      return { ...state, ...logic };
    }, { initialProps: { rows: items }, wrapper });
  }
  it("keeps the selected item after insertion, removal above it, sorting and filtering", () => {
    const { result, rerender } = setup();
    act(() => result.current.setSelectedIndex(1));
    rerender({ rows: [{ ...items[0], id: 0 }, ...items] });
    expect(result.current.selectedItem?.id).toBe(2);
    expect(result.current.selectedIndex).toBe(2);
    rerender({ rows: items.slice(1) });
    expect(result.current.selectedItem?.id).toBe(2);
    act(() => result.current.applyWiSort("id"));
    expect(result.current.selectedItem?.id).toBe(2);
    act(() => result.current.setColumnFilters({ state: new Set(["Active"]) }));
    expect(result.current.selectedItem?.id).toBe(2);
    act(() => result.current.clearAllFilters());
    expect(result.current.selectedItem?.id).toBe(2);
  });
  it("selects the nearby remaining item when the selected key disappears", () => {
    const { result, rerender } = setup();
    act(() => result.current.setSelectedIndex(1));
    rerender({ rows: [items[0], items[2]] });
    expect(result.current.selectedItem?.id).toBe(3);
    rerender({ rows: [] });
    expect(result.current.selectedItem).toBeNull();
  });
});

describe("Commits focused selection", () => {
  it("keeps the preview and keyboard action on the selected commit after refresh and sorting", () => {
    const props = { results: commits, loading: false, searched: true };
    const { rerender } = render(<CommitResults {...props} />, { wrapper });
    fireEvent.click(screen.getByText("Commit 2"));
    const inserted = { ...commits[0], commitId: "new", comment: "New commit", authorDate: "2026-02-01" };
    rerender(<CommitResults {...props} results={[inserted, ...commits]} />);
    expect(screen.getByTestId("commit-preview").textContent).toBe("sha2");
    const grid = screen.getByRole("grid", { name: "Commit search results" });
    fireEvent.keyDown(grid, { key: "o" });
    expect(openExternalUrl).toHaveBeenLastCalledWith(commits[1].webUrl);
    fireEvent.click(screen.getByRole("button", { name: "Sort by Date" }));
    expect(screen.getByTestId("commit-preview").textContent).toBe("sha2");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(screen.getByTestId("commit-preview").textContent).toBe("sha1");
  });
});

describe("keyed selection boundaries", () => {
  it("distinguishes identical IDs across organizations and remembers the new position for removal", () => {
    const rows = [{ org: "a", id: 1 }, { org: "b", id: 1 }, { org: "b", id: 2 }];
    const { result, rerender } = renderHook(({ rows }) =>
      useKeyedGridSelection(rows, (row) => `${row.org}:${row.id}`),
    { initialProps: { rows } });
    act(() => result.current.setSelectedIndex(1));
    rerender({ rows: [rows[1], rows[0], rows[2]] });
    expect(result.current.selectedRow).toEqual(rows[1]);
    rerender({ rows: [rows[0], rows[2]] });
    expect(result.current.selectedRow).toEqual(rows[0]);
  });
});
