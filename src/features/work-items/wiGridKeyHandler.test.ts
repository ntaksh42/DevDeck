import { describe, expect, it, vi } from "vitest";
import type { WorkItemSummary } from "@/lib/azdoCommands";
import { createWiKeyHandler, type WiKeyHandlerDeps } from "./wiGridKeyHandler";

function makeItem(overrides: Partial<WorkItemSummary> = {}): WorkItemSummary {
  return {
    organizationId: "contoso",
    projectId: "project-1",
    projectName: "Platform",
    id: 456,
    title: "Fix login",
    workItemType: "Bug",
    state: "Active",
    assignedTo: null,
    changedDate: null,
    webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/456",
    tags: null,
    extraFields: [],
    depth: null,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<WiKeyHandlerDeps> = {}): WiKeyHandlerDeps {
  return {
    selectedIndex: 0,
    displayed: [makeItem()],
    checkedIds: new Set(),
    checkedItems: [],
    openFilterCol: null,
    triageScope: undefined,
    snoozeEnabled: false,
    snoozeTargetRef: { current: [] },
    rowRefs: { current: [] },
    moveSelection: vi.fn(),
    setOpenFilterCol: vi.fn(),
    setFilterAnchorRect: vi.fn(),
    setBulkAssignOpen: vi.fn(),
    setBulkStateOpen: vi.fn(),
    setBulkPriorityOpen: vi.fn(),
    setColumnMenuRect: vi.fn(),
    setCopyToast: vi.fn(),
    setFocusCommentRequest: vi.fn(),
    setTriageVersion: vi.fn(),
    setSnoozeAnchorRect: vi.fn(),
    setOpenAssigneeRequest: vi.fn(),
    setOpenStateRequest: vi.fn(),
    setOpenPriorityRequest: vi.fn(),
    setOpenFieldRequest: vi.fn(),
    handleCheckboxChange: vi.fn(),
    clearCheckedIds: vi.fn(),
    selectRangeTo: vi.fn(),
    ...overrides,
  };
}

function fireKey(key: string, deps: WiKeyHandlerDeps) {
  const handler = createWiKeyHandler(deps);
  const preventDefault = vi.fn();
  handler({
    key,
    target: document.body,
    defaultPrevented: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault,
  } as unknown as React.KeyboardEvent);
}

describe("createWiKeyHandler — copy as Markdown link", () => {
  it("copies the selected work item as a Markdown link on 'l'", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const setCopyToast = vi.fn();

    fireKey("l", makeDeps({ setCopyToast }));

    expect(writeText).toHaveBeenCalledWith(
      "[#456 Fix login](https://dev.azure.com/contoso/Platform/_workitems/edit/456)",
    );
    await Promise.resolve();
    expect(setCopyToast).toHaveBeenCalledWith("Markdown link copied");
  });

  it("does nothing when the selected item has no webUrl", () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    fireKey("L", makeDeps({ displayed: [makeItem({ webUrl: null })] }));

    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("createWiKeyHandler — Ctrl+C copies the selection", () => {
  function fireCtrlC(deps: WiKeyHandlerDeps) {
    const handler = createWiKeyHandler(deps);
    handler({
      key: "c",
      target: document.body,
      defaultPrevented: false,
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent);
  }

  it("copies every checked work item's URL, one per line", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const setCopyToast = vi.fn();
    const checkedItems = [
      makeItem({ id: 456, webUrl: "https://dev.azure.com/a/_workitems/edit/456" }),
      makeItem({ id: 789, webUrl: "https://dev.azure.com/a/_workitems/edit/789" }),
    ];

    fireCtrlC(makeDeps({ checkedItems, setCopyToast }));

    expect(writeText).toHaveBeenCalledWith(
      "https://dev.azure.com/a/_workitems/edit/456\nhttps://dev.azure.com/a/_workitems/edit/789",
    );
    await Promise.resolve();
    expect(setCopyToast).toHaveBeenCalledWith("2 URLs copied");
  });

  it("falls back to the focused row when nothing is checked", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    fireCtrlC(makeDeps({ checkedItems: [] }));

    expect(writeText).toHaveBeenCalledWith(
      "https://dev.azure.com/contoso/Platform/_workitems/edit/456",
    );
  });
});

describe("createWiKeyHandler — snooze", () => {
  it("opens snooze for every checked work item", () => {
    const checkedItems = [makeItem({ id: 456 }), makeItem({ id: 789 })];
    const snoozeTargetRef = { current: [] as WorkItemSummary[] };
    const setSnoozeAnchorRect = vi.fn();

    fireKey("z", makeDeps({
      checkedItems,
      snoozeEnabled: true,
      snoozeTargetRef,
      setSnoozeAnchorRect,
    }));

    expect(snoozeTargetRef.current).toEqual(checkedItems);
    expect(setSnoozeAnchorRect).toHaveBeenCalledTimes(1);
  });
});
