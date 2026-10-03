import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrReviewToolbarMenu } from "./PrReviewToolbarMenu";

afterEach(cleanup);

describe("PrReviewToolbarMenu", () => {
  it("is keyboard-operable: opens on the first item, arrows move, Esc returns focus", () => {
    const zoomIn = vi.fn();
    const email = vi.fn();
    render(
      <PrReviewToolbarMenu
        items={[
          { label: "Zoom in", onSelect: zoomIn, keepOpen: true },
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
    expect(zoomIn).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);

    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(items[1], { key: "Escape" });
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
    expect(document.activeElement).toBe(trigger);
  });

  it("closes, runs the action, and refocuses the trigger for other items", () => {
    const email = vi.fn();
    render(<PrReviewToolbarMenu items={[{ label: "Email a link", onSelect: email }]} />);
    const trigger = screen.getByRole("button", { name: "View options" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Email a link" }));
    expect(email).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
    expect(document.activeElement).toBe(trigger);
  });

  it("ignores a disabled item but keeps it focusable", () => {
    const zoomIn = vi.fn();
    render(
      <PrReviewToolbarMenu items={[{ label: "Zoom in", onSelect: zoomIn, disabled: true, keepOpen: true }]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "View options" }));
    const item = screen.getByRole("menuitem", { name: "Zoom in" });
    expect(document.activeElement).toBe(item);
    fireEvent.click(item);
    expect(zoomIn).not.toHaveBeenCalled();
  });
});
