import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { useGridFocusRestoration } from "./useGridFocusRestoration";

function makeContainer() {
  const container = document.createElement("div");
  const row = document.createElement("div");
  row.setAttribute("role", "row");
  row.tabIndex = -1;
  container.appendChild(row);
  document.body.appendChild(container);
  return { container, row };
}

describe("useGridFocusRestoration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  function setup(restoreFocus: () => boolean) {
    const { container, row } = makeContainer();
    const containerRef = createRef<HTMLElement>();
    containerRef.current = container;
    const utils = renderHook(
      ({ signature }) =>
        useGridFocusRestoration({ containerRef, restoreSignature: signature, restoreFocus }),
      { initialProps: { signature: "a" } },
    );
    return { ...utils, container, row };
  }

  it("restores focus to the selected row when the data signature changes", () => {
    const restoreFocus = vi.fn(() => true);
    const { result, rerender, row } = setup(restoreFocus);

    // The grid gains focus on a row, then the data set is replaced.
    act(() => {
      result.current.onFocusCapture({ target: row } as never);
    });
    rerender({ signature: "b" });
    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(restoreFocus).toHaveBeenCalled();
  });

  it("does not steal focus when the grid never had focus", () => {
    const restoreFocus = vi.fn(() => true);
    const { rerender } = setup(restoreFocus);

    rerender({ signature: "b" });
    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(restoreFocus).not.toHaveBeenCalled();
  });

  it("restores a primary listbox's focused option after it is removed", () => {
    const replacement = document.createElement("div");
    replacement.setAttribute("role", "option");
    replacement.tabIndex = 0;
    const restoreFocus = vi.fn(() => {
      replacement.focus();
      return true;
    });
    const { result, rerender, container, row } = setup(restoreFocus);
    container.setAttribute("role", "listbox");
    container.dataset.primaryGrid = "true";
    row.setAttribute("role", "option");
    act(() => {
      row.focus();
      result.current.onFocusCapture({ target: row } as never);
      row.remove();
      result.current.onBlurCapture({ relatedTarget: null } as never);
      container.appendChild(replacement);
    });
    rerender({ signature: "b" });
    act(() => vi.advanceTimersByTime(20));
    expect(document.activeElement).toBe(replacement);
  });

  it("keeps focus ownership when a node-removal blur reports a null relatedTarget", () => {
    const restoreFocus = vi.fn(() => true);
    const { result, row } = setup(restoreFocus);

    act(() => {
      result.current.onFocusCapture({ target: row } as never);
    });
    // A data update detaches the focused row: focus falls back to <body> and
    // the blur reports no relatedTarget. Ownership must not be dropped yet, or
    // the restoration that follows would be skipped.
    act(() => {
      result.current.onBlurCapture({ relatedTarget: null } as never);
    });

    expect(result.current.hadFocusRef.current).toBe(true);
  });

  it("drops focus ownership when focus genuinely leaves the grid", () => {
    const restoreFocus = vi.fn(() => true);
    const { result, row } = setup(restoreFocus);

    act(() => {
      result.current.onFocusCapture({ target: row } as never);
    });
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    act(() => {
      result.current.onBlurCapture({ relatedTarget: outside } as never);
    });

    expect(result.current.hadFocusRef.current).toBe(false);
  });

  it("does not steal focus when the user is editing in the preview pane", () => {
    const restoreFocus = vi.fn(() => true);
    const { result, rerender, container, row } = setup(restoreFocus);

    // The grid owned focus, then the user moved into an editor that lives in
    // the same container (e.g. the preview comment box) and started typing.
    act(() => {
      result.current.onFocusCapture({ target: row } as never);
    });
    const editor = document.createElement("textarea");
    container.appendChild(editor);
    editor.focus();

    // A background sync replaces the rows: the signature changes but focus must
    // stay on the editor rather than jumping back to the row.
    rerender({ signature: "b" });
    act(() => {
      vi.advanceTimersByTime(40);
    });

    expect(restoreFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(editor);
  });

  describe("after the user scrolls the grid", () => {
    // The scroller wraps the grid, as in Work Items and My Reviews.
    function setupScroller(restoreFocus: () => boolean) {
      const utils = setup(restoreFocus);
      const scroller = document.createElement("div");
      const grid = document.createElement("div");
      grid.setAttribute("role", "grid");
      grid.dataset.primaryGrid = "true";
      grid.tabIndex = -1;
      grid.appendChild(utils.row);
      scroller.appendChild(grid);
      utils.container.appendChild(scroller);
      setRect(scroller, 0, 300);
      return { ...utils, scroller, grid };
    }

    function setRect(element: HTMLElement, top: number, bottom: number) {
      element.getBoundingClientRect = () => ({ top, bottom }) as DOMRect;
    }

    function focusRow(utils: ReturnType<typeof setupScroller>) {
      act(() => {
        utils.row.focus();
        utils.result.current.onFocusCapture({ target: utils.row } as never);
      });
    }

    function syncAndSettle(utils: ReturnType<typeof setupScroller>) {
      utils.rerender({ signature: "b" });
      act(() => {
        vi.advanceTimersByTime(40);
      });
    }

    it("does not pull the grid back once the focused row has scrolled out", () => {
      const restoreFocus = vi.fn(() => true);
      const utils = setupScroller(restoreFocus);
      focusRow(utils);

      // The wheel moves the row out of view and virtualization unmounts it,
      // which React never reports as a blur.
      utils.row.remove();
      act(() => {
        utils.scroller.dispatchEvent(new Event("scroll"));
      });
      syncAndSettle(utils);

      expect(utils.result.current.hadFocusRef.current).toBe(false);
      expect(restoreFocus).not.toHaveBeenCalled();
    });

    it("drops ownership when the still-focused row is scrolled out of view", () => {
      const restoreFocus = vi.fn(() => true);
      const utils = setupScroller(restoreFocus);
      focusRow(utils);
      setRect(utils.row, 900, 929);

      act(() => {
        utils.scroller.dispatchEvent(new Event("scroll"));
      });

      expect(utils.result.current.hadFocusRef.current).toBe(false);
    });

    it("keeps restoring while the focused row stays in view", () => {
      const restoreFocus = vi.fn(() => true);
      const utils = setupScroller(restoreFocus);
      focusRow(utils);
      setRect(utils.row, 100, 129);

      act(() => {
        utils.scroller.dispatchEvent(new Event("scroll"));
      });
      syncAndSettle(utils);

      expect(restoreFocus).toHaveBeenCalled();
    });

    it("keeps ownership while a keyboard jump parks focus on the grid", () => {
      const restoreFocus = vi.fn(() => true);
      const utils = setupScroller(restoreFocus);
      focusRow(utils);
      setRect(utils.grid, -5000, 5000);
      act(() => {
        utils.grid.focus();
        utils.scroller.dispatchEvent(new Event("scroll"));
      });
      syncAndSettle(utils);

      expect(restoreFocus).toHaveBeenCalled();
    });

    it("keeps ownership while a grid that wraps its scroller holds focus", () => {
      const restoreFocus = vi.fn(() => true);
      const utils = setupScroller(restoreFocus);
      // PR search and Inbox put the scroller inside the grid / listbox.
      const outerGrid = document.createElement("div");
      outerGrid.setAttribute("role", "grid");
      outerGrid.tabIndex = -1;
      utils.container.appendChild(outerGrid);
      outerGrid.appendChild(utils.scroller);
      focusRow(utils);
      act(() => {
        outerGrid.focus();
        utils.scroller.dispatchEvent(new Event("scroll"));
      });

      expect(utils.result.current.hadFocusRef.current).toBe(true);
    });

    it("ignores scrolling a pane that is not the grid", () => {
      const restoreFocus = vi.fn(() => true);
      const utils = setupScroller(restoreFocus);
      focusRow(utils);
      utils.row.remove();
      const preview = document.createElement("div");
      utils.container.appendChild(preview);

      act(() => {
        preview.dispatchEvent(new Event("scroll"));
      });

      expect(utils.result.current.hadFocusRef.current).toBe(true);
    });
  });

  it("retries restoration until the row mounts back into the window", () => {
    let mounted = false;
    const restoreFocus = vi.fn(() => {
      if (!mounted) return false;
      return true;
    });
    const { result, rerender, row } = setup(restoreFocus);

    act(() => {
      result.current.onFocusCapture({ target: row } as never);
    });
    rerender({ signature: "b" });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(restoreFocus).toHaveBeenCalledTimes(1);

    // The row scrolls back into view a frame later.
    mounted = true;
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(restoreFocus).toHaveBeenCalledTimes(2);
  });
});
