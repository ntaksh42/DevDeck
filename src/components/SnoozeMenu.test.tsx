import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SnoozeMenu } from "./SnoozeMenu";

// This project's vitest config has no global setup, so Testing Library's
// automatic cleanup isn't registered; unmount explicitly between tests.
afterEach(cleanup);

const anchorRect = {
  top: 0,
  left: 0,
  bottom: 24,
  right: 100,
  width: 100,
  height: 24,
  x: 0,
  y: 0,
  toJSON() {},
} as DOMRect;

// Mimics the grid behind the menu: a container that moves its row selection on
// arrow keys. The bug in #190 is that, with the snooze menu open via keyboard,
// arrows leaked through to this handler and moved the grid selection.
function renderWithGrid(onSnooze = vi.fn(), onClose = vi.fn()) {
  const gridArrow = vi.fn();
  render(
    <div
      data-testid="grid"
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") gridArrow();
      }}
    >
      <SnoozeMenu anchorRect={anchorRect} onSnooze={onSnooze} onClose={onClose} />
    </div>,
  );
  return { gridArrow, onSnooze, onClose };
}

describe("SnoozeMenu keyboard containment", () => {
  it("focuses the first preset on open", () => {
    renderWithGrid();
    const presets = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(presets[0]);
  });

  it("does not leak arrows to the grid when focus is inside the menu", () => {
    const { gridArrow } = renderWithGrid();
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(gridArrow).not.toHaveBeenCalled();
  });

  it("does not leak arrows to the grid even when focus slips outside the menu", () => {
    // Regression for #190: if focus is on the grid/body when the menu is open,
    // the capture-phase guard must still swallow arrows so the grid stays put.
    const { gridArrow } = renderWithGrid();
    // Fire the arrows from the grid itself (focus has slipped out of the menu).
    // Without the capture-phase guard these reach the grid's own onKeyDown.
    const grid = screen.getByTestId("grid");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(gridArrow).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const { onClose } = renderWithGrid();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
