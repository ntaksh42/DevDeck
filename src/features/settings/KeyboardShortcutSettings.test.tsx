import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KeyboardShortcutSettings } from "./KeyboardShortcutSettings";

afterEach(cleanup);

describe("KeyboardShortcutSettings", () => {
  it("keeps focus on the shortcut when Escape cancels a rebind", () => {
    render(<KeyboardShortcutSettings />);
    const button = screen
      .getAllByRole("button", { name: /\(Enter to rebind\)$/ })
      .find((candidate) => !(candidate as HTMLButtonElement).disabled) as HTMLButtonElement;
    button.focus();
    fireEvent.click(button);
    expect(button.getAttribute("aria-label")).toMatch(/Esc to cancel/);

    fireEvent.keyDown(button, { key: "Escape" });
    expect(button.getAttribute("aria-label")).toMatch(/Enter to rebind/);
    expect(document.activeElement).toBe(button);
  });
});
