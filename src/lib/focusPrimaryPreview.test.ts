import { afterEach, describe, expect, it, vi } from "vitest";
import { focusPrimaryPreview } from "./utils";

// jsdom has no layout, so rects are supplied per element through data-rect.
function mockRects() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const [left, top, width, height] = (this.getAttribute("data-rect") ?? "0,0,0,0").split(",").map(Number);
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
  });
}

function preview(id: string, rect: string) {
  return `<div data-testid="${id}" data-primary-preview="true" tabindex="-1" data-rect="${rect}"></div>`;
}

describe("focusPrimaryPreview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("skips a preview clipped away inside a collapsed dock group", () => {
    mockRects();
    document.body.innerHTML = `
      <div style="overflow:hidden" data-rect="0,889,500,0">${preview("collapsed", "0,963,500,14")}</div>
      <div style="overflow:hidden" data-rect="500,100,500,600">${preview("visible", "500,100,500,600")}</div>`;
    expect(focusPrimaryPreview()).toBe(true);
    expect(document.activeElement).toBe(document.querySelector("[data-testid='visible']"));
  });

  it("keeps the first preview when several are on screen", () => {
    mockRects();
    document.body.innerHTML = preview("a", "0,0,300,300") + preview("b", "300,0,300,300");
    expect(focusPrimaryPreview()).toBe(true);
    expect(document.activeElement).toBe(document.querySelector("[data-testid='a']"));
  });

  it("falls back to the first preview when none is measurable", () => {
    document.body.innerHTML = preview("a", "0,0,0,0") + preview("b", "0,0,0,0");
    expect(focusPrimaryPreview()).toBe(true);
    expect(document.activeElement).toBe(document.querySelector("[data-testid='a']"));
  });

  it("returns false without any preview", () => {
    expect(focusPrimaryPreview()).toBe(false);
  });
});
