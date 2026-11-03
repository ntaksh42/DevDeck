import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindFramePaneFocus, handlePaneCycleKey, handlePaneFocusKey } from "./paneFocus";

function pane(id: string, x: number, y = 0, width = 200, height = 300) {
  const root = document.createElement("div");
  root.dataset.focusPane = id;
  root.dataset.paneEditable = "true";
  root.tabIndex = -1;
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(x, y, width, height));
  const surface = document.createElement("div");
  surface.dataset.paneFocusTarget = "true";
  surface.tabIndex = -1;
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(new DOMRect(x, y, width, height));
  root.appendChild(surface);
  document.body.appendChild(root);
  return { root, surface };
}

function press(target: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  target.focus();
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}

const onKeyDown = (event: KeyboardEvent) => {
  if (!handlePaneCycleKey(event)) handlePaneFocusKey(event);
};

beforeEach(() => document.addEventListener("keydown", onKeyDown, true));
afterEach(() => {
  document.removeEventListener("keydown", onKeyDown, true);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Ctrl+Tab pane cycle", () => {
  it("cycles in screen order including read-only Result and wraps in both directions", () => {
    const result = pane("result", 400);
    delete result.root.dataset.paneEditable;
    const preview = pane("preview", 200);
    const grid = pane("grid", 0);
    const lower = pane("lower", 0, 400);
    press(grid.surface, "Tab", { ctrlKey: true });
    expect(document.activeElement).toBe(preview.surface);
    press(preview.surface, "Tab", { ctrlKey: true });
    expect(document.activeElement).toBe(result.surface);
    press(result.surface, "Tab", { ctrlKey: true });
    expect(document.activeElement).toBe(lower.surface);
    press(lower.surface, "Tab", { ctrlKey: true });
    expect(document.activeElement).toBe(grid.surface);
    press(grid.surface, "Tab", { ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(lower.surface);
    press(lower.surface, "Tab", { ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(result.surface);
  });

  it("returns to the grid selection without changing the editor draft", () => {
    const grid = pane("grid", 0);
    grid.surface.dataset.primaryGrid = "true";
    const row = document.createElement("div");
    row.setAttribute("role", "row");
    row.setAttribute("aria-selected", "true");
    row.tabIndex = 0;
    grid.surface.appendChild(row);
    const preview = pane("preview", 200);
    const input = document.createElement("textarea");
    input.value = "draft";
    preview.surface.appendChild(input);
    press(input, "Tab", { ctrlKey: true });
    expect(document.activeElement).toBe(row);
    expect(input.value).toBe("draft");
  });

  it("cycles from a dock tab or toolbar relative to its own pane", () => {
    const grid = pane("grid", 0);
    const preview = pane("preview", 200);
    const result = pane("result", 400);
    const group = document.createElement("div");
    group.className = "dv-groupview";
    const tab = document.createElement("button");
    group.append(tab, preview.root);
    document.body.appendChild(group);
    press(tab, "Tab", { ctrlKey: true });
    expect(document.activeElement).toBe(result.surface);
    press(tab, "Tab", { ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(grid.surface);
  });

  it("skips hidden panes and outer wrappers while including visible nested panes", () => {
    const grid = pane("grid", 0);
    pane("hidden", 200, 0, 0, 0);
    const preview = pane("preview", 400);
    const nested = pane("details", 400);
    preview.root.appendChild(nested.root);
    const side = pane("side", 600);
    preview.root.appendChild(side.root);
    const inactive = pane("inactive", 800);
    inactive.root.setAttribute("aria-hidden", "true");
    press(grid.surface, "Tab", { ctrlKey: true });
    expect(document.activeElement).toBe(nested.surface);
    press(nested.surface, "Tab", { ctrlKey: true });
    expect(document.activeElement).toBe(side.surface);
    press(side.surface, "Tab", { ctrlKey: true });
    expect(document.activeElement).toBe(grid.surface);
  });

  it("skips content clipped by a collapsed group", () => {
    const grid = pane("grid", 0);
    const collapsed = pane("collapsed", 200, 0, 200, 0);
    collapsed.root.style.overflowY = "hidden";
    const child = pane("details", 200);
    collapsed.root.appendChild(child.root);
    const result = pane("result", 400);
    press(grid.surface, "Tab", { ctrlKey: true });
    expect(document.activeElement).toBe(result.surface);
  });

  it.each(["dialog", "alertdialog", "menu"])("does not leave an open %s", (role) => {
    const grid = pane("grid", 0);
    pane("preview", 200);
    const overlay = pane("overlay", 0);
    overlay.root.setAttribute("role", role);
    expect(press(grid.surface, "Tab", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(grid.surface);
    overlay.root.style.visibility = "hidden";
    press(grid.surface, "Tab", { ctrlKey: true });
    expect(document.activeElement).not.toBe(grid.surface);
  });

  it.each(["altKey", "metaKey", "isComposing"])("preserves %s Ctrl+Tab gestures", (modifier) => {
    const grid = pane("grid", 0);
    pane("preview", 200);
    expect(press(grid.surface, "Tab", { ctrlKey: true, [modifier]: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(grid.surface);
  });

  it.each([false, true])("preserves ordinary Tab navigation with shiftKey %s", (shiftKey) => {
    const grid = pane("grid", 0);
    pane("preview", 200);
    expect(press(grid.surface, "Tab", { ctrlKey: false, shiftKey }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(grid.surface);
  });

  it("enters at either end from outside the panes, and handles a single pane or no panes", () => {
    expect(press(document.body, "Tab", { ctrlKey: true }).defaultPrevented).toBe(false);
    const grid = pane("grid", 0);
    press(document.body, "Tab", { ctrlKey: true });
    expect(document.activeElement).toBe(grid.surface);
    press(grid.surface, "Tab", { ctrlKey: true });
    expect(document.activeElement).toBe(grid.surface);
    const result = pane("result", 200);
    press(document.body, "Tab", { ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(result.surface);
  });

  it("cycles from iframe links and selections as well as its body", () => {
    const preview = pane("preview", 0);
    const result = pane("result", 200);
    const frame = document.createElement("iframe");
    preview.surface.appendChild(frame);
    const doc = frame.contentDocument!;
    const link = doc.createElement("a");
    link.href = "https://example.com";
    doc.body.appendChild(link);
    bindFramePaneFocus(frame);
    vi.spyOn(doc, "getSelection").mockReturnValue({ isCollapsed: false } as Selection);
    link.focus();
    link.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(result.surface);
    doc.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(result.surface);
  });
});

describe("pane focus", () => {
  it("follows physical placement across editable panes and returns to the selected grid row", () => {
    const right = pane("agent", 400);
    const conversation = document.createElement("button");
    conversation.tabIndex = 0;
    right.surface.appendChild(conversation);
    const left = pane("grid", 0);
    delete left.root.dataset.paneEditable;
    const middle = pane("preview", 200);
    left.surface.dataset.primaryGrid = "true";
    const selected = document.createElement("div");
    selected.setAttribute("role", "row");
    selected.setAttribute("aria-selected", "true");
    selected.tabIndex = 0;
    left.surface.appendChild(selected);
    press(selected, "ArrowRight");
    expect(document.activeElement).toBe(middle.surface);
    press(middle.surface, "ArrowRight");
    expect(document.activeElement).toBe(right.surface);
    press(right.surface, "ArrowLeft");
    expect(document.activeElement).toBe(middle.surface);
    press(middle.surface, "ArrowLeft");
    expect(document.activeElement).toBe(selected);
  });

  it("skips result HTML and read-only panes as destinations", () => {
    const preview = pane("preview", 0);
    const result = pane("result", 200);
    delete result.root.dataset.paneEditable;
    const readOnly = pane("read-only", 400);
    delete readOnly.root.dataset.paneEditable;
    const agent = pane("agent", 600);
    press(preview.surface, "ArrowRight");
    expect(document.activeElement).toBe(agent.surface);
    press(agent.surface, "ArrowLeft");
    expect(document.activeElement).toBe(preview.surface);
    press(result.surface, "ArrowRight");
    expect(document.activeElement).toBe(agent.surface);
  });

  it("does not treat an editor in a nested pane as editing its parent", () => {
    const source = pane("source", 0);
    const parent = pane("read-only", 200);
    delete parent.root.dataset.paneEditable;
    const nested = pane("nested-editor", 200, 0, 0, 0);
    parent.root.appendChild(nested.root);
    const agent = pane("agent", 400);
    press(source.surface, "ArrowRight");
    expect(document.activeElement).toBe(agent.surface);
  });

  it("skips hidden panes and parent wrappers and stays at the outside edge", () => {
    const left = pane("grid", 0);
    pane("hidden", 200, 0, 0, 0);
    const right = pane("preview", 400);
    const parent = pane("view", 0, 0, 600);
    parent.root.append(left.root, right.root);
    press(left.surface, "ArrowRight");
    expect(document.activeElement).toBe(right.surface);
    expect(press(right.surface, "ArrowRight").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(right.surface);
  });

  it("excludes nested editors inside a collapsed pane", () => {
    const source = pane("source", 0);
    const collapsed = pane("collapsed", 200, 0, 200, 0);
    const child = pane("editor", 200, 0, 200, 2);
    collapsed.root.appendChild(child.root);
    const agent = pane("agent", 400);
    press(source.surface, "ArrowRight");
    expect(document.activeElement).toBe(agent.surface);
  });

  it("prefers the adjacent pane in the same horizontal band", () => {
    const left = pane("grid", 0, 200);
    pane("upper", 200, 0, 200, 100);
    const lower = pane("lower", 200, 200);
    press(left.surface, "ArrowRight");
    expect(document.activeElement).toBe(lower.surface);
  });

  it.each(["input", "textarea", "select", "button", "a"])("preserves %s arrow keys", (tag) => {
    const left = pane("grid", 0);
    pane("preview", 200);
    const control = document.createElement(tag);
    control.tabIndex = 0;
    left.surface.appendChild(control);
    expect(press(control, "ArrowRight").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(control);
  });

  it.each(["tree", "menu", "dialog", "radiogroup"])("preserves arrows inside a %s", (role) => {
    const left = pane("grid", 0);
    pane("preview", 200);
    left.root.setAttribute("role", role);
    expect(press(left.surface, "ArrowRight").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(left.surface);
  });

  it.each(["ctrlKey", "metaKey", "altKey", "shiftKey", "isComposing"])("preserves %s gestures", (modifier) => {
    const left = pane("grid", 0);
    pane("preview", 200);
    expect(press(left.surface, "ArrowRight", { [modifier]: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(left.surface);
  });

  it("preserves board arrow navigation", () => {
    const left = pane("board", 0);
    left.root.dataset.paneArrowKeys = "local";
    pane("preview", 200);
    expect(press(left.surface, "ArrowRight").defaultPrevented).toBe(false);
  });

  it("forwards iframe body arrows but preserves its controls and selections", () => {
    const left = pane("preview", 0);
    const right = pane("agent", 200);
    const frame = document.createElement("iframe");
    left.surface.appendChild(frame);
    const doc = frame.contentDocument!;
    bindFramePaneFocus(frame);
    doc.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(right.surface);
    left.surface.focus();
    const input = doc.createElement("input");
    doc.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(left.surface);
    vi.spyOn(doc, "getSelection").mockReturnValue({ isCollapsed: false } as Selection);
    doc.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(left.surface);
  });
});
