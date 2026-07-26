import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultKeybindingMap } from "@/lib/keybindings";
import { useKeyboardShortcuts, type UseKeyboardShortcutsParams } from "./useKeyboardShortcuts";

// This project does not enable vitest globals, so RTL's automatic cleanup
// isn't registered; unmount explicitly between tests.
afterEach(cleanup);

function makeParams(overrides: Partial<UseKeyboardShortcutsParams> = {}) {
  return {
    activeView: "myReviews" as const,
    organizationsLength: 1,
    syncPending: false,
    syncAll: vi.fn(),
    keybindings: defaultKeybindingMap(),
    navigateHistory: vi.fn(),
    openCommandPalette: vi.fn(),
    openHelp: vi.fn(),
    closeHelp: vi.fn(),
    closeCommandPalette: vi.fn(),
    setView: vi.fn(),
    setSidebarCollapsed: vi.fn(),
    refreshCurrentView: vi.fn(),
    focusNavigation: vi.fn(),
    ...overrides,
  };
}

/** Renders the hook alongside an editable target and an optional grid. */
function renderHarness(
  params: ReturnType<typeof makeParams>,
  { withGrid }: { withGrid: boolean },
) {
  function Harness() {
    useKeyboardShortcuts(params);
    return (
      <div>
        {withGrid ? <div data-primary-grid="true" tabIndex={-1} role="grid" /> : null}
        <textarea aria-label="editor" />
      </div>
    );
  }
  const utils = render(<Harness />);
  const editor = utils.getByLabelText("editor");
  editor.focus();
  return { ...utils, editor };
}

describe("useKeyboardShortcuts while a text editor is focused", () => {
  // Regression: syncNow/openSettings/toggleSidebar missed the editable guard
  // the neighbouring Ctrl shortcuts all have, so typing in a comment box could
  // kick off a sync or jump to Settings mid-edit.
  it.each([
    ["Ctrl+E (sync now)", { key: "e", ctrlKey: true }, "syncAll"],
    ["Ctrl+, (open settings)", { key: ",", ctrlKey: true }, "setView"],
    ["Ctrl+\\ (toggle sidebar)", { key: "\\", ctrlKey: true }, "setSidebarCollapsed"],
  ] as const)("does not fire %s", (_label, keyInit, spyName) => {
    const params = makeParams();
    const { editor } = renderHarness(params, { withGrid: true });

    fireEvent.keyDown(editor, keyInit);

    expect(params[spyName]).not.toHaveBeenCalled();
  });

  it("still fires those shortcuts when focus is outside an editor", () => {
    const params = makeParams();
    renderHarness(params, { withGrid: true });
    (document.activeElement as HTMLElement | null)?.blur();

    fireEvent.keyDown(document.body, { key: "e", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: ",", ctrlKey: true });

    expect(params.syncAll).toHaveBeenCalledTimes(1);
    expect(params.setView).toHaveBeenCalledWith("settings");
  });

  // Regression: with no grid to fall back to, Escape fell through and closed
  // the help dialog and the command palette behind the user.
  it("keeps Escape from closing overlays on a screen without a grid", () => {
    const params = makeParams();
    const { editor } = renderHarness(params, { withGrid: false });

    fireEvent.keyDown(editor, { key: "Escape" });

    expect(params.closeHelp).not.toHaveBeenCalled();
    expect(params.closeCommandPalette).not.toHaveBeenCalled();
  });

  it("returns focus to the grid on Escape when one exists", () => {
    const params = makeParams();
    const { editor, container } = renderHarness(params, { withGrid: true });

    fireEvent.keyDown(editor, { key: "Escape" });

    expect(document.activeElement).toBe(container.querySelector("[data-primary-grid='true']"));
    expect(params.closeHelp).not.toHaveBeenCalled();
  });

  it("closes overlays on Escape when focus is not in an editor", () => {
    const params = makeParams();
    renderHarness(params, { withGrid: true });
    (document.activeElement as HTMLElement | null)?.blur();

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(params.closeHelp).toHaveBeenCalled();
    expect(params.closeCommandPalette).toHaveBeenCalled();
  });
});

describe("useKeyboardShortcuts Ctrl+S", () => {
  // Regression: outside a work item view the handler returned without
  // preventDefault, so the WebView's "save page" dialog opened.
  it("suppresses the browser default even where there is nothing to apply", () => {
    const params = makeParams({ activeView: "myReviews" });
    renderHarness(params, { withGrid: true });
    (document.activeElement as HTMLElement | null)?.blur();

    const event = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});
