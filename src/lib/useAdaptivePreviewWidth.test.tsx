import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAdaptivePreviewWidth } from "./useAdaptivePreviewWidth";

let resizeCallback: ResizeObserverCallback;
let layout: ReturnType<typeof useAdaptivePreviewWidth>;

class ResizeObserverMock {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }
  observe() {}
  disconnect() {}
}

describe("useAdaptivePreviewWidth", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps the saved preview ratio when the available width changes", () => {
    function Harness() {
      layout = useAdaptivePreviewWidth({
        defaultWidth: 420,
        maxPreviewWidth: 8192,
        minPreviewWidth: 280,
        storageKey: "azdodeck:layout:testPreviewRatio",
      });
      return <div ref={layout.containerRef} />;
    }
    render(<Harness />);

    act(() => resizeCallback([
      { contentRect: { width: 1032 } } as ResizeObserverEntry,
    ], {} as ResizeObserver));
    expect(layout.width).toBe(400);

    act(() => layout.setWidth(500));
    expect(layout.width).toBe(500);
    expect(window.localStorage.getItem("azdodeck:layout:testPreviewRatio")).toBe("0.5");

    act(() => resizeCallback([
      { contentRect: { width: 1232 } } as ResizeObserverEntry,
    ], {} as ResizeObserver));
    expect(layout.width).toBe(600);
  });

  it("keeps enough room for the grid", () => {
    function Harness() {
      layout = useAdaptivePreviewWidth({
        defaultWidth: 460,
        maxPreviewWidth: 8192,
        minPreviewWidth: 320,
        storageKey: "azdodeck:layout:testPreviewRatio",
      });
      return <div ref={layout.containerRef} />;
    }
    render(<Harness />);

    act(() => resizeCallback([
      { contentRect: { width: 1032 } } as ResizeObserverEntry,
    ], {} as ResizeObserver));
    act(() => layout.setWidth(900));

    expect(layout.max).toBe(520);
    expect(layout.width).toBe(520);
  });

  it("loads a separate ratio when the view storage key changes", () => {
    window.localStorage.setItem("azdodeck:layout:secondPreviewRatio", "0.3");

    function Harness({ storageKey }: { storageKey: string }) {
      layout = useAdaptivePreviewWidth({
        defaultWidth: 440,
        maxPreviewWidth: 8192,
        minPreviewWidth: 280,
        storageKey,
      });
      return <div ref={layout.containerRef} />;
    }
    const view = render(<Harness storageKey="azdodeck:layout:firstPreviewRatio" />);
    act(() => resizeCallback([
      { contentRect: { width: 1032 } } as ResizeObserverEntry,
    ], {} as ResizeObserver));
    act(() => layout.setWidth(500));

    view.rerender(<Harness storageKey="azdodeck:layout:secondPreviewRatio" />);

    expect(layout.width).toBe(300);
    expect(window.localStorage.getItem("azdodeck:layout:firstPreviewRatio")).toBe("0.5");
  });
});
