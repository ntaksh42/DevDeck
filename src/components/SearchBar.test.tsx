import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { focusFilterInput } from "@/lib/utils";
import { SearchInput, SearchSubmitButton } from "./SearchBar";

afterEach(cleanup);

describe("SearchInput", () => {
  it("is the field Ctrl+F and / focus", () => {
    render(<SearchInput value="" onChange={() => undefined} placeholder="title, author, branch…" />);

    expect(focusFilterInput()).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search" }));
  });
});

describe("SearchSubmitButton", () => {
  it("stays focusable while pending and swallows submits instead of disabling", () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <SearchSubmitButton pending />
      </form>,
    );

    const button = screen.getByRole("button", { name: "Search" }) as HTMLButtonElement;
    button.focus();
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits when idle and is truly disabled when explicitly disabled", () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const { rerender } = render(
      <form onSubmit={onSubmit}>
        <SearchSubmitButton pending={false} />
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    rerender(
      <form onSubmit={onSubmit}>
        <SearchSubmitButton pending={false} disabled />
      </form>,
    );
    expect((screen.getByRole("button", { name: "Search" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
