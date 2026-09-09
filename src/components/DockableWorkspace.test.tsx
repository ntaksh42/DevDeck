import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DockableWorkspace, type DockablePanelSpec } from "./DockableWorkspace";

// jsdom reports 0 for every layout dimension, so dockview would clamp every
// panel to its minimum regardless of the requested width. Mock a realistic
// container size so these assertions exercise real dockview sizing math.
beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(800);
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function twoPanels(overrides: Partial<{ grid: React.ReactNode; preview: React.ReactNode }> = {}): DockablePanelSpec[] {
  return [
    { id: "grid", title: "Grid", content: overrides.grid ?? <div>grid content</div>, minWidth: 480 },
    {
      id: "preview",
      title: "Preview",
      content: overrides.preview ?? <div>preview content</div>,
      position: { relativeTo: "grid", direction: "right" },
      initialWidth: 420,
      minWidth: 280,
      maxWidth: 8192,
    },
  ];
}

function renderWorkspace(storageKey = "test:dockable-workspace", panels = twoPanels()) {
  render(<DockableWorkspace storageKey={storageKey} panels={panels} />);
  return screen.getByRole("separator", { name: "Resize Preview" });
}

describe("DockableWorkspace", () => {
  it("uses dockview's light theme when the app is in light mode", () => {
    renderWorkspace("test:dockable-workspace:light-theme");

    expect(document.querySelector(".dockview-theme-light")).toBeTruthy();
    expect(document.querySelector(".dockview-theme-vs")).toBeNull();
  });

  it("keeps dockview tab bars compact", () => {
    renderWorkspace("test:dockable-workspace:compact-tabs");

    const dockview = document.querySelector(".dv-dockview");
    expect(getComputedStyle(dockview!).getPropertyValue("--dv-tabs-and-actions-container-height")).toBe(
      "20px",
    );
  });

  it("keeps dockview tab bars compact in dark mode", () => {
    document.documentElement.classList.add("dark");
    renderWorkspace("test:dockable-workspace:compact-tabs-dark");

    const dockview = document.querySelector(".dv-dockview");
    expect(getComputedStyle(dockview!).getPropertyValue("--dv-tabs-and-actions-container-height")).toBe(
      "20px",
    );
  });

  it("sizes the split panel to its initialWidth and renders every panel", () => {
    renderWorkspace();
    expect(screen.getByText("grid content")).toBeTruthy();
    expect(screen.getByText("preview content")).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize Preview" }).getAttribute("aria-valuenow")).toBe(
      "420",
    );
  });

  it("stretches panel content to the full dockview size without shrinking it", () => {
    renderWorkspace("test:dockable-workspace:full-height");

    const contentLayout = screen.getByText("preview content").parentElement;
    expect(contentLayout?.style.display).toBe("grid");
    expect(contentLayout?.style.height).toBe("100%");
    expect(contentLayout?.style.width).toBe("100%");
  });

  it("resizes a panel from the keyboard and persists the layout", () => {
    vi.useFakeTimers();
    const storageKey = "test:dockable-workspace:persist";
    const resize = renderWorkspace(storageKey);

    fireEvent.keyDown(resize, { key: "ArrowLeft" });
    expect(resize.getAttribute("aria-valuenow")).toBe("436");
    act(() => vi.advanceTimersByTime(100));
    expect(window.localStorage.getItem(`${storageKey}:schema:v3`)).toBeTruthy();

    fireEvent.doubleClick(resize);
    expect(resize.getAttribute("aria-valuenow")).toBe("420");
  });

  it("coalesces repeated resize events into one persisted layout", () => {
    vi.useFakeTimers();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const resize = renderWorkspace("test:dockable-workspace:debounced-persist");
    setItem.mockClear();

    fireEvent.keyDown(resize, { key: "ArrowLeft" });
    fireEvent.keyDown(resize, { key: "ArrowLeft" });
    fireEvent.keyDown(resize, { key: "ArrowLeft" });

    expect(setItem).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(100));
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("reflects updated panel content on rerender", () => {
    const storageKey = "test:dockable-workspace:content";
    const { rerender } = render(
      <DockableWorkspace storageKey={storageKey} panels={twoPanels({ grid: <div>grid v1</div>, preview: <div>preview v1</div> })} />,
    );
    expect(screen.getByText("grid v1")).toBeTruthy();
    expect(screen.getByText("preview v1")).toBeTruthy();

    rerender(
      <DockableWorkspace storageKey={storageKey} panels={twoPanels({ grid: <div>grid v2</div>, preview: <div>preview v2</div> })} />,
    );
    expect(screen.getByText("grid v2")).toBeTruthy();
    expect(screen.getByText("preview v2")).toBeTruthy();
    expect(screen.queryByText("grid v1")).toBeNull();
    expect(screen.queryByText("preview v1")).toBeNull();
  });

  it("rebuilds the dockview layout when its storage key changes", () => {
    const { rerender } = render(
      <DockableWorkspace storageKey="test:dockable-workspace:key-a" panels={twoPanels()} />,
    );
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize Preview" }), {
      key: "ArrowLeft",
    });
    expect(screen.getByRole("separator", { name: "Resize Preview" }).getAttribute("aria-valuenow")).toBe(
      "436",
    );

    rerender(<DockableWorkspace storageKey="test:dockable-workspace:key-b" panels={twoPanels()} />);

    expect(screen.getByRole("separator", { name: "Resize Preview" }).getAttribute("aria-valuenow")).toBe(
      "420",
    );
  });

  it("clamps keyboard resize to minWidth, and to the space left by the anchor's minimum width", () => {
    const resize = renderWorkspace("test:dockable-workspace:clamp");

    for (let i = 0; i < 10; i += 1) {
      fireEvent.keyDown(resize, { key: "ArrowRight" });
    }
    expect(Number(resize.getAttribute("aria-valuenow"))).toBe(280);

    // maxWidth is 8192, but the 1200px mocked container leaves only
    // 1200 - grid minWidth(480) = 720px for the preview panel to grow into.
    for (let i = 0; i < 60; i += 1) {
      fireEvent.keyDown(resize, { key: "ArrowLeft" });
    }
    expect(Number(resize.getAttribute("aria-valuenow"))).toBe(720);
  });

  it("restores a previously persisted width across a remount", () => {
    vi.useFakeTimers();
    const storageKey = "test:dockable-workspace:restore";
    const { unmount } = render(<DockableWorkspace storageKey={storageKey} panels={twoPanels()} />);
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize Preview" }), { key: "ArrowLeft" });
    expect(screen.getByRole("separator", { name: "Resize Preview" }).getAttribute("aria-valuenow")).toBe(
      "436",
    );
    act(() => vi.advanceTimersByTime(100));
    expect(window.localStorage.getItem(`${storageKey}:schema:v3`)).toBeTruthy();
    unmount();

    render(<DockableWorkspace storageKey={storageKey} panels={twoPanels()} />);
    expect(screen.getByRole("separator", { name: "Resize Preview" }).getAttribute("aria-valuenow")).toBe(
      "436",
    );
  });

  it("ignores layouts saved before the current layout schema", () => {
    vi.useFakeTimers();
    const fixtureKey = "test:dockable-workspace:legacy-fixture";
    const storageKey = "test:dockable-workspace:legacy";
    const { unmount } = render(<DockableWorkspace storageKey={fixtureKey} panels={twoPanels()} />);
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize Preview" }), {
      key: "ArrowLeft",
    });
    act(() => vi.advanceTimersByTime(100));
    const legacyLayout = window.localStorage.getItem(`${fixtureKey}:schema:v3`);
    expect(legacyLayout).toBeTruthy();
    unmount();

    window.localStorage.setItem(`${storageKey}:schema:v2`, legacyLayout!);
    render(<DockableWorkspace storageKey={storageKey} panels={twoPanels()} />);

    expect(screen.getByRole("separator", { name: "Resize Preview" }).getAttribute("aria-valuenow")).toBe(
      "420",
    );
  });

  it("falls back to the default layout when the persisted JSON is corrupt", () => {
    const storageKey = "test:dockable-workspace:corrupt";
    window.localStorage.setItem(`${storageKey}:schema:v3`, "not valid json");

    const resize = renderWorkspace(storageKey);
    expect(resize.getAttribute("aria-valuenow")).toBe("420");
    expect(screen.getByText("grid content")).toBeTruthy();
    expect(screen.getByText("preview content")).toBeTruthy();
  });

  it("supports more than two panels, each independently resizable", () => {
    const panels: DockablePanelSpec[] = [
      { id: "grid", title: "Grid", content: <div>grid content</div>, minWidth: 480 },
      {
        id: "preview",
        title: "Preview",
        content: <div>preview content</div>,
        position: { relativeTo: "grid", direction: "right" },
        initialWidth: 420,
        minWidth: 280,
        maxWidth: 8192,
      },
      {
        id: "result",
        title: "Result",
        content: <div>result content</div>,
        position: { relativeTo: "preview", direction: "right" },
        initialWidth: 320,
        minWidth: 200,
        maxWidth: 8192,
      },
    ];
    render(<DockableWorkspace storageKey="test:dockable-workspace:three" panels={panels} />);

    expect(screen.getByText("grid content")).toBeTruthy();
    expect(screen.getByText("preview content")).toBeTruthy();
    expect(screen.getByText("result content")).toBeTruthy();

    const previewResize = screen.getByRole("separator", { name: "Resize Preview" });
    const resultResize = screen.getByRole("separator", { name: "Resize Result" });
    // Splitting Result out of Preview carves Result's initialWidth directly
    // out of Preview's own space (dockview splits the referenced panel, not
    // the row's free space), so Preview lands at its floor here rather than
    // its own initialWidth -- both panels remain independently resizable.
    expect(previewResize.getAttribute("aria-valuenow")).toBe("280");
    expect(resultResize.getAttribute("aria-valuenow")).toBe("320");

    fireEvent.keyDown(resultResize, { key: "ArrowLeft" });
    expect(resultResize.getAttribute("aria-valuenow")).toBe("336");
    // Resizing Result does not disturb Preview's own reported width.
    expect(previewResize.getAttribute("aria-valuenow")).toBe("280");
  });

  describe("move menu", () => {
    function threePanels(): DockablePanelSpec[] {
      return [
        { id: "grid", title: "Grid", content: <div>grid content</div>, minWidth: 480 },
        {
          id: "preview",
          title: "Preview",
          content: <div>preview content</div>,
          position: { relativeTo: "grid", direction: "right" },
          initialWidth: 420,
          minWidth: 280,
          maxWidth: 8192,
        },
        {
          id: "result",
          title: "Result",
          content: <div>result content</div>,
          position: { relativeTo: "preview", direction: "right" },
          initialWidth: 320,
          minWidth: 200,
          maxWidth: 8192,
        },
      ];
    }

    // dockview's drag-and-drop is the only built-in way to reposition a
    // panel, and its keyboard equivalent is a dockview-enterprise module this
    // app doesn't have -- so this menu is the only keyboard path to move a
    // panel at all. These tests exercise it end to end rather than just the
    // UI, since a menu that opens but doesn't actually relocate the panel
    // would still leave the app keyboard-inoperable for this action.
    it("moves a panel into another panel's group as a tab", () => {
      render(<DockableWorkspace storageKey="test:dockable-workspace:move-tab" panels={threePanels()} />);

      expect(screen.getByRole("separator", { name: "Resize Result" })).toBeTruthy();
      expect(screen.getByText("grid content")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Move Result panel" }));
      const menu = screen.getByRole("menu", { name: "Move Result" });
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Tab with Grid" }));

      // Result is now tabbed inside Grid's group instead of its own split --
      // Preview's separator (unaffected) still reports its own width, Result
      // is the active tab in the merged group (having just moved in), and
      // Grid's own content sits behind it, hidden until that tab is picked.
      expect(screen.getByRole("separator", { name: "Resize Preview" })).toBeTruthy();
      expect(screen.getByRole("tab", { name: "Result" })).toBeTruthy();
      expect(screen.getByText("result content")).toBeTruthy();
      expect(screen.queryByText("grid content")).toBeNull();
    });

    it("splits a panel into a new position relative to another panel", () => {
      render(<DockableWorkspace storageKey="test:dockable-workspace:move-split" panels={threePanels()} />);

      fireEvent.click(screen.getByRole("button", { name: "Move Result panel" }));
      fireEvent.click(
        within(screen.getByRole("menu", { name: "Move Result" })).getByRole("menuitem", {
          name: "Split below Grid",
        }),
      );

      // Still its own split (not merged into another group), so it keeps its
      // resize handle and its content stays visible without needing a tab
      // click -- confirming this was a genuine reposition, not a no-op.
      expect(screen.getByRole("separator", { name: "Resize Result" })).toBeTruthy();
      expect(screen.getByText("result content")).toBeTruthy();
    });

    it("closes the move menu on Escape and returns focus to the trigger button", () => {
      render(<DockableWorkspace storageKey="test:dockable-workspace:move-escape" panels={threePanels()} />);

      const trigger = screen.getByRole("button", { name: "Move Result panel" });
      fireEvent.click(trigger);
      const menu = screen.getByRole("menu", { name: "Move Result" });

      fireEvent.keyDown(menu, { key: "Escape" });
      expect(screen.queryByRole("menu", { name: "Move Result" })).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it("navigates the move menu's items with the arrow keys", () => {
      render(<DockableWorkspace storageKey="test:dockable-workspace:move-arrows" panels={threePanels()} />);

      fireEvent.click(screen.getByRole("button", { name: "Move Result panel" }));
      const menu = screen.getByRole("menu", { name: "Move Result" });
      const items = within(menu).getAllByRole("menuitem");

      expect(document.activeElement).toBe(items[0]);
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      expect(document.activeElement).toBe(items[1]);
      fireEvent.keyDown(menu, { key: "ArrowUp" });
      expect(document.activeElement).toBe(items[0]);
    });
  });

  it("pins a tabbed group's width bounds so they don't flip with the active tab", () => {
    // Mirrors Work Items: "Result" is tabbed into "Preview"'s own group but
    // declares a different minWidth and no maxWidth at all. A dockview group
    // with no explicit constraints of its own derives them from whichever
    // panel is currently ACTIVE (DockviewGroupPanel.minimumWidth /
    // maximumWidth), so the pane's own resize limits change as the user
    // switches tabs -- the same drag stops somewhere else, which reads as the
    // width adjustment being unstable.
    const panels: DockablePanelSpec[] = [
      { id: "grid", title: "Grid", content: <div>grid content</div>, minWidth: 480 },
      {
        id: "preview",
        title: "Preview",
        content: <div>preview content</div>,
        position: { relativeTo: "grid", direction: "right" },
        initialWidth: 420,
        minWidth: 300,
        maxWidth: 8192,
      },
      {
        id: "result",
        title: "Result",
        content: <div>result content</div>,
        position: { relativeTo: "preview", direction: "within" },
        minWidth: 320,
      },
    ];

    render(<DockableWorkspace storageKey="test:dockable-workspace:tab-bounds" panels={panels} />);
    const resize = screen.getByRole("separator", { name: "Resize Preview" });

    // Squeeze the pane against its floor through dockview's own sizing (the
    // handle asks via api.setSize; aria-valuenow reports what dockview
    // granted), then read where it came to rest.
    function floorWidth(pointerId: number) {
      fireEvent.pointerDown(resize, { clientX: 900, pointerId });
      fireEvent.pointerMove(window, { clientX: 3000, pointerId });
      fireEvent.pointerUp(window, { clientX: 3000, pointerId });
      return Number(resize.getAttribute("aria-valuenow"));
    }

    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    const floorWithPreview = floorWidth(1);

    fireEvent.click(screen.getByRole("tab", { name: "Result" }));
    const floorWithResult = floorWidth(2);

    // The floor must not move when the active tab changes.
    expect(floorWithResult).toBe(floorWithPreview);
    // It is the widest floor any panel in the group needs (Result's 320),
    // so switching tabs can never force dockview to widen the pane out from
    // under the user.
    expect(floorWithPreview).toBe(320);
  });
});
