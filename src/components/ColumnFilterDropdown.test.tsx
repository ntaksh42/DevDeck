import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ColumnFilterDropdown } from "./ColumnFilterDropdown";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function anchorRect(): DOMRect {
  return {
    top: 0, left: 0, bottom: 20, right: 100,
    width: 100, height: 20, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function renderDropdown(
  overrides: Partial<Parameters<typeof ColumnFilterDropdown>[0]> = {},
) {
  const props = {
    anchorRect: anchorRect(),
    allValues: ["Active", "Closed"],
    activeValues: undefined,
    onToggle: vi.fn(),
    onClearAll: vi.fn(),
    onUncheckAll: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const { container } = render(<ColumnFilterDropdown {...props} />);
  // The component's root is the positioned popup that owns the key handler.
  return { props, dropdown: container.firstElementChild as HTMLElement };
}

function activeLabel(): string {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return "";
  if (active instanceof HTMLInputElement) {
    return active.type === "checkbox" ? `checkbox:${active.checked}` : "search";
  }
  return active.textContent?.trim() ?? "";
}

describe("ColumnFilterDropdown keyboard navigation", () => {
  it("reaches every enabled control with the arrow keys, including Uncheck all", () => {
    const { dropdown } = renderDropdown();

    const visited: string[] = [];
    for (let i = 0; i < 4; i++) {
      fireEvent.keyDown(dropdown, { key: "ArrowDown" });
      visited.push(activeLabel());
    }

    // "Uncheck all" was unreachable before it carried the traversal marker.
    expect(visited).toContain("Uncheck all");
    expect(visited).toContain("(All)");
  });

  it("skips the disabled Uncheck all button", () => {
    // An empty set means "none selected", which disables "Uncheck all"; a
    // disabled control must not absorb focus during traversal.
    const { dropdown } = renderDropdown({ activeValues: new Set<string>() });

    fireEvent.keyDown(dropdown, { key: "ArrowDown" });
    expect(activeLabel()).toBe("(All)");
    fireEvent.keyDown(dropdown, { key: "ArrowDown" });
    expect(activeLabel()).toBe("checkbox:false");
  });

  it("returns focus to the button that opened it when unmounted", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    const restoreFocusRef = { current: button as HTMLElement | null };

    const { unmount } = render(
      <ColumnFilterDropdown
        anchorRect={anchorRect()}
        allValues={["Active"]}
        activeValues={undefined}
        onToggle={vi.fn()}
        onClearAll={vi.fn()}
        onUncheckAll={vi.fn()}
        onClose={vi.fn()}
        restoreFocusRef={restoreFocusRef}
      />,
    );

    vi.useFakeTimers();
    unmount();
    vi.runAllTimers();
    vi.useRealTimers();

    expect(document.activeElement).toBe(button);
  });
});
