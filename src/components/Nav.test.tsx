import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NavSubItem } from "./Nav";

afterEach(cleanup);

describe("NavSubItem badge", () => {
  it("folds the count into the button's accessible name", () => {
    render(<NavSubItem active={false} label="My Reviews" badge={3} onClick={() => {}} />);
    // Visible pill shows the number...
    expect(screen.getByText("3")).toBeTruthy();
    // ...and the button announces it, since a button's aria-label would
    // otherwise swallow the nested badge text for screen readers.
    expect(screen.getByRole("button", { name: "My Reviews, 3" })).toBeTruthy();
  });

  it("hides the badge and the count from the name for zero or null", () => {
    const { rerender } = render(
      <NavSubItem active={false} label="My Reviews" badge={0} onClick={() => {}} />,
    );
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getByRole("button", { name: "My Reviews" })).toBeTruthy();
    rerender(<NavSubItem active={false} label="My Reviews" badge={null} onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "My Reviews" })).toBeTruthy();
  });

  it("caps the visible pill at 99+ but announces the exact count", () => {
    render(<NavSubItem active={false} label="My Items" badge={250} onClick={() => {}} />);
    expect(screen.getByText("99+")).toBeTruthy();
    expect(screen.getByRole("button", { name: "My Items, 250" })).toBeTruthy();
  });
});
