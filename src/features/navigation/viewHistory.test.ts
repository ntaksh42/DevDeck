import { describe, expect, it } from "vitest";
import {
  canGoBack,
  canGoForward,
  emptyViewHistory,
  goBack,
  goForward,
  pushView,
} from "./viewHistory";

describe("viewHistory", () => {
  it("records visits and tracks the current index", () => {
    let h = emptyViewHistory<string>();
    h = pushView(h, "a");
    h = pushView(h, "b");
    h = pushView(h, "c");
    expect(h.stack).toEqual(["a", "b", "c"]);
    expect(h.index).toBe(2);
    expect(canGoBack(h)).toBe(true);
    expect(canGoForward(h)).toBe(false);
  });

  it("ignores a repeat of the current view", () => {
    let h = emptyViewHistory<string>();
    h = pushView(h, "a");
    h = pushView(h, "a");
    expect(h.stack).toEqual(["a"]);
    expect(h.index).toBe(0);
  });

  it("goes back and forward through the stack", () => {
    let h = emptyViewHistory<string>();
    h = pushView(h, "a");
    h = pushView(h, "b");
    h = pushView(h, "c");

    const back1 = goBack(h)!;
    expect(back1.view).toBe("b");
    const back2 = goBack(back1.history)!;
    expect(back2.view).toBe("a");
    expect(goBack(back2.history)).toBeNull();

    const fwd = goForward(back2.history)!;
    expect(fwd.view).toBe("b");
  });

  it("truncates forward history when navigating after going back", () => {
    let h = emptyViewHistory<string>();
    h = pushView(h, "a");
    h = pushView(h, "b");
    h = pushView(h, "c");
    h = goBack(h)!.history; // now at "b" (index 1)
    h = pushView(h, "d"); // diverge
    expect(h.stack).toEqual(["a", "b", "d"]);
    expect(h.index).toBe(2);
    expect(canGoForward(h)).toBe(false);
  });

  it("caps the depth, dropping the oldest entries", () => {
    let h = emptyViewHistory<string>();
    for (let i = 0; i < 5; i += 1) {
      h = pushView(h, `v${i}`, 3);
    }
    expect(h.stack).toEqual(["v2", "v3", "v4"]);
    expect(h.index).toBe(2);
  });
});
