import { useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { focusFilterInput } from "@/lib/utils";
import { ReviewFilterBar } from "./ReviewFilterBar";

function Harness(props: Partial<Parameters<typeof ReviewFilterBar>[0]>) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <ReviewFilterBar
      textFilter=""
      onTextFilterChange={() => undefined}
      filterInputRef={inputRef}
      showDrafts={false}
      onShowDraftsChange={() => undefined}
      filterSuggestionPool={[]}
      open={false}
      onOpen={() => undefined}
      onClose={() => undefined}
      {...props}
    />
  );
}

describe("ReviewFilterBar", () => {
  afterEach(cleanup);

  it("stays folded to a Ctrl+F button that Ctrl+F's focusFilterInput activates", () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);

    expect(screen.queryByRole("combobox", { name: "Filter" })).toBeNull();
    expect(focusFilterInput()).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("keeps the text filter visible as a clearable chip while folded", () => {
    const onTextFilterChange = vi.fn();
    render(<Harness textFilter="api" onTextFilterChange={onTextFilterChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Clear “api”" }));
    expect(onTextFilterChange).toHaveBeenCalledWith("");
  });

  it("shows the Show Drafts checkbox with the draft count while the filter is folded", () => {
    const onShowDraftsChange = vi.fn();
    const { rerender } = render(<Harness draftCount={2} onShowDraftsChange={onShowDraftsChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Show Drafts (2)" }));
    expect(onShowDraftsChange).toHaveBeenCalledWith(true);
    rerender(<Harness draftCount={0} />);
    expect(screen.getByRole("checkbox", { name: "Show Drafts" })).toBeTruthy();
  });

  it("focuses the input when opened and folds back on Escape, returning focus", () => {
    const onClose = vi.fn();
    render(<Harness open textFilter="api" onClose={onClose} />);

    const input = screen.getByRole("combobox", { name: "Filter" });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("folds without stealing focus when an empty filter loses focus", () => {
    const onClose = vi.fn();
    render(
      <>
        <Harness open onClose={onClose} />
        <button type="button">elsewhere</button>
      </>,
    );

    fireEvent.blur(screen.getByRole("combobox", { name: "Filter" }), {
      relatedTarget: screen.getByRole("button", { name: "elsewhere" }),
    });
    expect(onClose).toHaveBeenCalledWith(false);
  });
});
