import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { recordRecentWorkItem } from "@/lib/recentItems";
import type { WorkItemSummary } from "@/lib/azdoCommands";
import { WiSearchHistory, type WiSearchFilters } from "./WiSearchHistory";

afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

const filters: WiSearchFilters = { states: ["Active"], workItemTypes: [], projectIds: [] };
const entry = { id: "e1", organizationId: "org1", query: "crash", filters, summary: "Active", at: new Date().toISOString() };

function mount(over: { recent?: typeof entry[]; saved?: typeof entry[] } = {}) {
  const handlers = { pin: vi.fn(), remove: vi.fn(), onRun: vi.fn(), onOpenItem: vi.fn() };
  render(
    <WiSearchHistory
      organizationId="org1"
      history={{
        history: { recent: over.recent ?? [entry], saved: over.saved ?? [] },
        record: vi.fn(),
        pin: handlers.pin,
        remove: handlers.remove,
      }}
      onRun={handlers.onRun}
      onOpenItem={handlers.onOpenItem}
    />,
  );
  return handlers;
}

describe("WiSearchHistory", () => {
  it("re-runs a recent search with its filters on Enter, pins on S, removes on Delete", () => {
    const h = mount();
    const row = document.querySelector<HTMLElement>("[data-history-row]")!;
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(h.onRun).toHaveBeenCalledWith("crash", filters);
    fireEvent.keyDown(row, { key: "s" });
    expect(h.pin).toHaveBeenCalledWith("e1");
    fireEvent.keyDown(row, { key: "Delete" });
    expect(h.remove).toHaveBeenCalledWith("recent", "e1");
  });

  it("lists recently viewed work items recorded from any view and opens one on Enter", () => {
    recordRecentWorkItem({
      id: 42, organizationId: "org1", projectId: "p", projectName: "Proj", title: "Fix login", webUrl: null,
    } as WorkItemSummary);
    const h = mount({ recent: [] });
    expect(screen.getByText("Recently viewed")).toBeTruthy();
    const row = document.querySelector<HTMLElement>("[data-history-row]")!;
    expect(row.textContent).toContain("#42 Fix login");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(h.onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }));
    fireEvent.keyDown(row, { key: "Delete" });
    expect(h.pin).not.toHaveBeenCalled();
  });
});
