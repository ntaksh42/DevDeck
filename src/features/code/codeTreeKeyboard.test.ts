import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleTreeKeyDown, type TypeAheadState } from "./codeTreeKeyboard";

// Builds a container with N flat (depth-0) file rows named row0..rowN-1, plus
// optional name overrides, attached to the document so focus()/activeElement
// work as they would in the real tree.
function buildRows(names: string[]): { container: HTMLDivElement; rows: HTMLButtonElement[] } {
  const container = document.createElement("div");
  const rows = names.map((name) => {
    const button = document.createElement("button");
    button.dataset.treeItem = "true";
    button.dataset.path = `/${name}`;
    button.dataset.name = name;
    button.dataset.folder = "false";
    button.tabIndex = -1;
    button.textContent = name;
    container.appendChild(button);
    return button;
  });
  document.body.appendChild(container);
  return { container, rows };
}

function fakeEvent(key: string): { event: ReturnType<typeof makeEvent>; preventDefault: ReturnType<typeof vi.fn> } {
  const preventDefault = vi.fn();
  const event = makeEvent(key, preventDefault);
  return { event, preventDefault };
}

function makeEvent(key: string, preventDefault: () => void) {
  return { key, ctrlKey: false, altKey: false, metaKey: false, preventDefault };
}

let typeAhead: { current: TypeAheadState };

beforeEach(() => {
  typeAhead = { current: { text: "", time: 0 } };
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("handleTreeKeyDown", () => {
  it("Home focuses the first row", () => {
    const { container, rows } = buildRows(["alpha", "beta", "gamma"]);
    rows[2].focus();
    const { event } = fakeEvent("Home");
    handleTreeKeyDown(event, container, typeAhead, vi.fn());
    expect(document.activeElement).toBe(rows[0]);
  });

  it("End focuses the last row", () => {
    const { container, rows } = buildRows(["alpha", "beta", "gamma"]);
    rows[0].focus();
    const { event } = fakeEvent("End");
    handleTreeKeyDown(event, container, typeAhead, vi.fn());
    expect(document.activeElement).toBe(rows[2]);
  });

  it("PageDown jumps forward by the page size, clamped to the last row", () => {
    const names = Array.from({ length: 15 }, (_, i) => `row${i}`);
    const { container, rows } = buildRows(names);
    rows[0].focus();
    const { event } = fakeEvent("PageDown");
    handleTreeKeyDown(event, container, typeAhead, vi.fn());
    expect(document.activeElement).toBe(rows[10]);
  });

  it("PageUp jumps backward by the page size, clamped to the first row", () => {
    const names = Array.from({ length: 15 }, (_, i) => `row${i}`);
    const { container, rows } = buildRows(names);
    rows[5].focus();
    const { event } = fakeEvent("PageUp");
    handleTreeKeyDown(event, container, typeAhead, vi.fn());
    expect(document.activeElement).toBe(rows[0]);
  });

  it("type-ahead jumps to the next row starting with the typed letter", () => {
    const { container, rows } = buildRows(["apple", "banana", "cherry"]);
    rows[0].focus();
    const { event } = fakeEvent("b");
    handleTreeKeyDown(event, container, typeAhead, vi.fn());
    expect(document.activeElement).toBe(rows[1]);
  });

  it("type-ahead accumulates consecutive keystrokes within the timeout window", () => {
    const { container, rows } = buildRows(["readme", "reducer", "router"]);
    // Start on a row that doesn't itself match, so the first keystroke's
    // "search after the current row" rule doesn't skip over "readme".
    rows[2].focus();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
    handleTreeKeyDown(fakeEvent("r").event, container, typeAhead, vi.fn());
    nowSpy.mockReturnValue(1100);
    handleTreeKeyDown(fakeEvent("e").event, container, typeAhead, vi.fn());
    nowSpy.mockReturnValue(1200);
    handleTreeKeyDown(fakeEvent("a").event, container, typeAhead, vi.fn());
    // "rea" only matches "readme" ("reducer" diverges at the third letter).
    expect(document.activeElement).toBe(rows[0]);
    nowSpy.mockRestore();
  });

  it("type-ahead wraps around to the start when no later row matches", () => {
    const { container, rows } = buildRows(["apple", "banana", "avocado"]);
    rows[1].focus();
    const { event } = fakeEvent("a");
    handleTreeKeyDown(event, container, typeAhead, vi.fn());
    expect(document.activeElement).toBe(rows[2]);
  });

  it("ArrowRight on a closed folder toggles it open", () => {
    const container = document.createElement("div");
    const folder = document.createElement("button");
    folder.dataset.treeItem = "true";
    folder.dataset.path = "/src";
    folder.dataset.name = "src";
    folder.dataset.folder = "true";
    folder.dataset.open = "false";
    folder.tabIndex = -1;
    container.appendChild(folder);
    document.body.appendChild(container);
    folder.focus();

    const onToggleFolder = vi.fn();
    const { event } = fakeEvent("ArrowRight");
    handleTreeKeyDown(event, container, typeAhead, onToggleFolder);
    expect(onToggleFolder).toHaveBeenCalledWith("/src");
  });
});
