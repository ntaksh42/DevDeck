import { type ReactNode, useRef, useState } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReviewPullRequestSummary, WorkItemSummary } from "./azdoCommands";
import { useMyReviewsSelectionState } from "@/features/pull-requests/useMyReviewsSelectionState";
import { useWiGridState } from "@/features/work-items/useWiGridState";
import { useWiGridLogic } from "@/features/work-items/useWiGridLogic";


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

function wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => { localStorage.clear(); });
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
      const logic = useWiGridLogic({ results: rows, loading: false, extraColumns: [], autoFocus: false }, state);
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
