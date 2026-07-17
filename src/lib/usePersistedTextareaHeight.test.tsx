import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  usePersistedTextareaHeight,
  WORK_ITEM_COMMENT_HEIGHT_STORAGE_KEY,
} from "./usePersistedTextareaHeight";

let resizeCallback: ResizeObserverCallback;

class ResizeObserverMock {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }

  observe() {}
  disconnect() {}
  unobserve() {}
}

function TestTextarea() {
  const ref = usePersistedTextareaHeight(WORK_ITEM_COMMENT_HEIGHT_STORAGE_KEY);
  return <textarea ref={ref} />;
}

describe("usePersistedTextareaHeight", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("restores and persists the resized height", () => {
    window.localStorage.setItem(WORK_ITEM_COMMENT_HEIGHT_STORAGE_KEY, "144");
    const { container, unmount } = render(<TestTextarea />);
    const textarea = container.querySelector("textarea")!;
    expect(textarea.style.height).toBe("144px");

    vi.spyOn(textarea, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ height: 216 }),
    );
    act(() => resizeCallback([], {} as ResizeObserver));
    expect(window.localStorage.getItem(WORK_ITEM_COMMENT_HEIGHT_STORAGE_KEY)).toBe("216");

    unmount();
    const rerendered = render(<TestTextarea />);
    expect(rerendered.container.querySelector("textarea")!.style.height).toBe("216px");
  });

  it("ignores invalid saved heights", () => {
    window.localStorage.setItem(WORK_ITEM_COMMENT_HEIGHT_STORAGE_KEY, "99999");
    const { container } = render(<TestTextarea />);

    expect(container.querySelector("textarea")!.style.height).toBe("");
  });
});
