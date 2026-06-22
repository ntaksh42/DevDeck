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
