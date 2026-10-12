import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindFramePaneFocus, handlePaneFocusKey } from "./paneFocus";

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

const onKeyDown = (event: KeyboardEvent) => { handlePaneFocusKey(event); };

beforeEach(() => document.addEventListener("keydown", onKeyDown, true));
afterEach(() => {
  document.removeEventListener("keydown", onKeyDown, true);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
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
