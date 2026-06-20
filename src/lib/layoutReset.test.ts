import { afterEach, describe, expect, it } from "vitest";
import {
  LAYOUT_STORAGE_PREFIX,
  clearLayoutStorage,
  layoutStorageKeys,
} from "./layoutReset";

afterEach(() => {
  window.localStorage.clear();
});

describe("layout reset", () => {
  it("lists only layout-prefixed keys", () => {
    window.localStorage.setItem(`${LAYOUT_STORAGE_PREFIX}sidebarWidth`, "248");
    window.localStorage.setItem(`${LAYOUT_STORAGE_PREFIX}commitPreviewWidth`, "420");
    window.localStorage.setItem("azdodeck:commandPalette:usage", "{}");
    window.localStorage.setItem("unrelated", "x");

    expect(layoutStorageKeys().sort()).toEqual([
      `${LAYOUT_STORAGE_PREFIX}commitPreviewWidth`,
      `${LAYOUT_STORAGE_PREFIX}sidebarWidth`,
    ]);
  });

  it("clears layout widths but keeps other settings", () => {
    window.localStorage.setItem(`${LAYOUT_STORAGE_PREFIX}sidebarWidth`, "248");
    window.localStorage.setItem(`${LAYOUT_STORAGE_PREFIX}wiSearchGridColumnWidths:v2`, "[1,2]");
    window.localStorage.setItem("azdodeck:commandPalette:usage", "{}");
    window.localStorage.setItem("azdodeck:workItemViews", "[]");

    const removed = clearLayoutStorage();

    expect(removed).toBe(2);
    expect(layoutStorageKeys()).toEqual([]);
    expect(window.localStorage.getItem("azdodeck:commandPalette:usage")).toBe("{}");
    expect(window.localStorage.getItem("azdodeck:workItemViews")).toBe("[]");
  });
});
