import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewOptionsMenu } from "./ViewOptionsMenu";

afterEach(cleanup);

describe("ViewOptionsMenu", () => {
  it("is keyboard-operable: opens on the first item, arrows move, Esc returns focus", () => {
    const stay = vi.fn();
    const email = vi.fn();
    render(
      <ViewOptionsMenu
        items={[
          { label: "Step", onSelect: stay, keepOpen: true },
          { label: "Email a link", onSelect: email },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "View options" });
    fireEvent.click(trigger);
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);

    // keepOpen items run without closing the menu.
    fireEvent.click(items[0]);
    expect(stay).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);

    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(items[1], { key: "Escape" });
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
    expect(document.activeElement).toBe(trigger);
  });

  it("closes, runs the action, and refocuses the trigger for other items", () => {
    const email = vi.fn();
    render(<ViewOptionsMenu items={[{ label: "Email a link", onSelect: email }]} />);
    const trigger = screen.getByRole("button", { name: "View options" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Email a link" }));
    expect(email).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
    expect(document.activeElement).toBe(trigger);
  });

  it("ignores a disabled item but keeps it focusable", () => {
    const run = vi.fn();
    render(<ViewOptionsMenu items={[{ label: "Step", onSelect: run, disabled: true, keepOpen: true }]} />);
    fireEvent.click(screen.getByRole("button", { name: "View options" }));
    const item = screen.getByRole("menuitem", { name: "Step" });
    expect(document.activeElement).toBe(item);
    fireEvent.click(item);
    expect(run).not.toHaveBeenCalled();
  });

  it("shows toggle state on checkbox items and the shortcut hint", () => {
    render(
      <ViewOptionsMenu
        items={[
          { label: "Follow", onSelect: vi.fn(), checked: true },
          { label: "Comments beside details", onSelect: vi.fn(), checked: false },
          { label: "Duplicate", onSelect: vi.fn(), hint: "D" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "View options" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Follow" }).getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Comments beside details" }).getAttribute("aria-checked"),
    ).toBe("false");
    expect(screen.getByRole("menuitem", { name: /Duplicate/ }).textContent).toContain("D");
    // Arrow keys move across both item kinds.
    const first = screen.getByRole("menuitemcheckbox", { name: "Follow" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitemcheckbox", { name: "Comments beside details" }));
  });

  it("disables the trigger when there is nothing to show", () => {
    render(<ViewOptionsMenu items={[]} />);
    expect((screen.getByRole("button", { name: "View options" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
