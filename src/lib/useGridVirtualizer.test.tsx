import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useVirtualRowWindow } from "./useGridVirtualizer";

function setup(overscan = 8) {
  const scroller = document.createElement("div");
  Object.defineProperties(scroller, {
    clientWidth: { value: 800 },
    clientHeight: { value: 290 },
  });
  const hook = renderHook(() =>
    useVirtualRowWindow(scroller, { rowCount: 1000, rowHeight: 29, overscan }),
  );
  const scroll = (top: number) => {
    scroller.scrollTop = top;
    scroller.dispatchEvent(new Event("scroll"));
  };
  const expectCovered = (top: number) => {
    expect(hook.result.current.firstRow * 29).toBeLessThanOrEqual(top);
    expect(hook.result.current.lastRow * 29).toBeGreaterThanOrEqual(top + 290);
  };
  return { ...hook, scroll, expectCovered };
}

describe("useVirtualRowWindow", () => {
  it("covers a large downward jump before the scroll event returns", () => {
    const { scroll, expectCovered } = setup();
    act(() => {
      scroll(2000);
      // React normally batches this native event until act returns. The rows
      // must already cover the new viewport before the browser can paint it.
      expectCovered(2000);
    });
  });

  it("covers a large upward jump before the scroll event returns", () => {
    const { scroll, expectCovered } = setup();
    act(() => scroll(2000));
    act(() => {
      scroll(100);
      expectCovered(100);
    });
  });

  it("keeps buffered movement batched and skips sub-row movement", () => {
    const { result, scroll } = setup();
    const initial = result.current;
    act(() => {
      scroll(1);
      expect(result.current).toBe(initial);
    });
    expect(result.current).toBe(initial);
    act(() => {
      scroll(29);
      expect(result.current).toBe(initial);
    });
    expect(result.current).not.toBe(initial);
  });

  it("measures accumulated movement against the committed window", () => {
    const { scroll, expectCovered } = setup();
    act(() => {
      for (const top of [100, 200, 300, 400, 500, 600, 700, 800]) scroll(top);
      expectCovered(800);
    });
  });

  it("covers immediate jumps when no overscan is configured", () => {
    const { scroll, expectCovered } = setup(0);
    act(() => {
      scroll(29);
      expectCovered(29);
    });
  });
});
