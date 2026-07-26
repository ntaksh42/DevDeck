import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ColumnFilterDropdown } from "./ColumnFilterDropdown";

// This project does not enable vitest globals, so RTL's automatic cleanup
// isn't registered; unmount explicitly between tests.
afterEach(cleanup);

function renderDropdown(activeValues: Set<string> | undefined) {
  const onUncheckAll = vi.fn();
  render(
    <ColumnFilterDropdown
      anchorRect={new DOMRect(0, 0, 10, 10)}
      allValues={["Alpha", "Beta"]}
      activeValues={activeValues}
      onToggle={vi.fn()}
      onClearAll={vi.fn()}
      onUncheckAll={onUncheckAll}
      onClose={vi.fn()}
    />,
  );
  return { onUncheckAll };
}

/** Presses ArrowDown until `predicate` holds, or gives up after `max` steps. */
function arrowDownUntil(predicate: () => boolean, max = 12): boolean {
  for (let i = 0; i < max; i += 1) {
    if (predicate()) return true;
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowDown" });
  }
  return predicate();
}

describe("ColumnFilterDropdown keyboard navigation", () => {
  // Regression: "Uncheck all" lacked data-filter-item, so the arrow-key cycle
  // skipped it and it could only be reached with Tab.
  it("reaches Uncheck all with the arrow keys", () => {
    renderDropdown(new Set(["Alpha"]));
    const uncheckAll = screen.getByRole("button", { name: "Uncheck all" });

    expect(arrowDownUntil(() => document.activeElement === uncheckAll)).toBe(true);
  });

  it("activates Uncheck all once focused from the keyboard", () => {
    const { onUncheckAll } = renderDropdown(new Set(["Alpha"]));
    const uncheckAll = screen.getByRole("button", { name: "Uncheck all" });

    arrowDownUntil(() => document.activeElement === uncheckAll);
    fireEvent.click(uncheckAll);

    expect(onUncheckAll).toHaveBeenCalledTimes(1);
  });

  it("skips Uncheck all while it is disabled", () => {
    // An empty set means "none selected", so there is nothing left to uncheck.
    renderDropdown(new Set());
    const uncheckAll = screen.getByRole("button", { name: "Uncheck all" });
    expect((uncheckAll as HTMLButtonElement).disabled).toBe(true);

    const reached = arrowDownUntil(() => document.activeElement === uncheckAll);

    expect(reached).toBe(false);
  });

  it("still cycles through the search box and (All)", () => {
    renderDropdown(new Set(["Alpha"]));

    expect(arrowDownUntil(() => document.activeElement === screen.getByText("(All)"))).toBe(true);
    expect(
      arrowDownUntil(() => document.activeElement === screen.getByPlaceholderText("Search…")),
    ).toBe(true);
  });
});
