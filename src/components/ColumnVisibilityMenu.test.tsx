import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ColumnVisibilityMenu } from "./ColumnVisibilityMenu";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const anchorRect = {
  top: 0, left: 0, bottom: 20, right: 100,
  width: 100, height: 20, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;

function menu() {
  return (
    <ColumnVisibilityMenu
      anchorRect={anchorRect}
      columns={[
        { key: "id", label: "ID" },
        { key: "title", label: "Title" },
      ]}
      visibleColumns={["id", "title"]}
      requiredColumns={["id"]}
      onToggle={vi.fn()}
      onReset={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

describe("ColumnVisibilityMenu", () => {
  it("opens focused on the first toggle even under StrictMode's simulated remount", () => {
    const grid = document.createElement("div");
    grid.tabIndex = 0;
    grid.setAttribute("data-primary-grid", "true");
    document.body.appendChild(grid);

    vi.useFakeTimers();
    render(<StrictMode>{menu()}</StrictMode>);
    vi.runAllTimers();
    vi.useRealTimers();

    // "ID" is required (disabled), so the first enabled toggle is "Title".
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: "Title" }));
  });

  it("returns focus to the primary grid when closed", () => {
    const grid = document.createElement("div");
    grid.tabIndex = 0;
    grid.setAttribute("data-primary-grid", "true");
    document.body.appendChild(grid);

    const { unmount } = render(menu());
    vi.useFakeTimers();
    unmount();
    vi.runAllTimers();
    vi.useRealTimers();

    expect(document.activeElement).toBe(grid);
  });

  it("labels each checkbox with its column name", () => {
    render(menu());
    expect(screen.getByRole("checkbox", { name: "ID" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Title" })).toBeTruthy();
  });
});
