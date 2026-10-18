import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommandPalette, type CommandPaletteAction } from "./CommandPalette";

afterEach(cleanup);

const USAGE_KEY = "azdodeck:commandPalette:usage";

const actions: CommandPaletteAction[] = [
  { id: "nav-a", group: "Navigation", label: "Go to A", run: vi.fn() },
  { id: "nav-b", group: "Navigation", label: "Go to B", run: vi.fn() },
  { id: "focus-a", group: "Focus", label: "Focus A", run: vi.fn() },
  { id: "focus-b", group: "Focus", label: "Focus B", run: vi.fn() },
];

it("runs the focused search result after results change order", async () => {
  const runA = vi.fn();
  const runB = vi.fn();
  const a = { id: "a", group: "Results", label: "Result A", run: runA };
  const b = { id: "b", group: "Results", label: "Result B", run: runB };
  const onClose = vi.fn();
  const view = (items: typeof a[]) => <CommandPalette actions={[]} onClose={onClose}
    search={{ items, pending: false, onQueryChange: vi.fn() }} />;
  const { rerender } = render(view([a, b]));
  const focused = screen.getByRole("button", { name: "Result B" });
  act(() => focused.focus());
  rerender(view([b, a]));
  expect(document.activeElement).toBe(focused);
  expect(focused.getAttribute("aria-current")).toBe("true");
  fireEvent.keyDown(focused, { key: "Enter" });
  await waitFor(() => expect(runB).toHaveBeenCalledTimes(1));
  expect(runA).not.toHaveBeenCalled();
});

it("leaves Enter on the close button to its native click action", () => {
  const run = vi.fn();
  const onClose = vi.fn();
  render(<CommandPalette actions={[{ id: "a", group: "Commands", label: "Run A", run }]} onClose={onClose} />);
  const close = screen.getByRole("button", { name: "Close command palette" });
  expect(fireEvent.keyDown(close, { key: "Enter" })).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(close);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(run).not.toHaveBeenCalled();
});

it("moves keyboard focus with the selection when navigating from a result button", () => {
  render(<CommandPalette actions={[]} onClose={vi.fn()} search={{
    items: [
      { id: "a", group: "Results", label: "Result A", run: vi.fn() },
      { id: "b", group: "Results", label: "Result B", run: vi.fn() },
    ], pending: false, onQueryChange: vi.fn(),
  }} />);
  const a = screen.getByRole("button", { name: "Result A" });
  const b = screen.getByRole("button", { name: "Result B" });
  act(() => a.focus());
  fireEvent.keyDown(a, { key: "ArrowDown" });
  expect(document.activeElement).toBe(b);
  fireEvent.keyDown(b, { key: "ArrowUp" });
  expect(document.activeElement).toBe(a);
});

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

describe("CommandPalette IME composition", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("does not run the active row or close when Enter/Escape confirm an IME composition", () => {
    const onClose = vi.fn();
    render(
      <CommandPalette
        actions={[{ id: "nav-a", group: "Navigation", label: "Go to A", run: vi.fn() }]}
        onClose={onClose}
      />,
    );
    const input = screen.getByPlaceholderText("Type a command...");

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Escape", isComposing: true });

    // Running a row (and Escape) both call onClose, so it covers either misfire.
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
