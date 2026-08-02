import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearToasts,
  dismissToast,
  getSnapshot,
  pushToast,
  subscribe,
} from "./toast";

describe("toast store", () => {
  beforeEach(() => {
    clearToasts();
  });

  it("holds pushed toasts in order", () => {
    pushToast("first");
    pushToast("second");
    expect(getSnapshot().map((t) => t.message)).toEqual(["first", "second"]);
  });

  it("keeps the retry callback with its toast", () => {
    const onRetry = vi.fn();
    pushToast("Vote failed", onRetry);
    getSnapshot()[0].onRetry?.();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("dismisses only the given toast", () => {
    const keep = pushToast("keep");
    const drop = pushToast("drop");
    dismissToast(drop);
    expect(getSnapshot().map((t) => t.id)).toEqual([keep]);
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    pushToast("one");
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    pushToast("two");
    expect(listener).toHaveBeenCalledOnce();
  });

  // useSyncExternalStore re-renders whenever the snapshot identity changes, so
  // a no-op dismiss must not produce a new array.
  it("keeps snapshot identity stable when nothing changes", () => {
    pushToast("only");
    const before = getSnapshot();
    dismissToast(9999);
    expect(getSnapshot()).toBe(before);
  });
});
