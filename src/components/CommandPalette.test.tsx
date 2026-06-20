import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CommandPalette, type CommandPaletteAction } from "./CommandPalette";

afterEach(cleanup);

const USAGE_KEY = "azdodeck:commandPalette:usage";

const actions: CommandPaletteAction[] = [
  { id: "nav-a", group: "Navigation", label: "Go to A", run: vi.fn() },
  { id: "nav-b", group: "Navigation", label: "Go to B", run: vi.fn() },
  { id: "focus-a", group: "Focus", label: "Focus A", run: vi.fn() },
  { id: "focus-b", group: "Focus", label: "Focus B", run: vi.fn() },
];

describe("CommandPalette grouping", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  function renderedGroupHeaders(): string[] {
    return screen
      .getAllByText(/^(Navigation|Focus)$/)
      .map((node) => node.textContent ?? "");
  }

  it("emits each group header exactly once when usage sort is applied", () => {
    // Seed usage so a low-priority group member would otherwise float to the top
    // and split its group apart from the global usage-descending sort.
    window.localStorage.setItem(
      USAGE_KEY,
      JSON.stringify({ "focus-b": 1000, "nav-a": 10 }),
    );

    render(<CommandPalette actions={actions} onClose={vi.fn()} />);

    const headers = renderedGroupHeaders();
    expect(headers).toEqual(["Navigation", "Focus"]);
  });

  it("sorts by usage within a group without breaking the group", () => {
    window.localStorage.setItem(
      USAGE_KEY,
      JSON.stringify({ "nav-b": 5000 }),
    );

    render(<CommandPalette actions={actions} onClose={vi.fn()} />);

    const labels = screen
      .getAllByRole("button")
      .map((node) => node.textContent ?? "")
      .filter((text) => /Go to|Focus/.test(text));

    expect(labels).toEqual(["Go to B", "Go to A", "Focus A", "Focus B"]);
  });
});
