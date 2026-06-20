import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NavSubItem } from "./Nav";

afterEach(cleanup);

describe("NavSubItem badge", () => {
  it("shows the count when positive", () => {
    render(<NavSubItem active={false} label="My Reviews" badge={3} onClick={() => {}} />);
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByLabelText("3 My Reviews")).toBeTruthy();
  });

  it("hides the badge for zero or null", () => {
    const { rerender } = render(
      <NavSubItem active={false} label="My Reviews" badge={0} onClick={() => {}} />,
    );
    expect(screen.queryByText("0")).toBeNull();
    // The badge has a "<count> <label>" aria-label; the button keeps "<label>".
    expect(screen.queryByLabelText(/^\d+ My Reviews$/)).toBeNull();
    rerender(<NavSubItem active={false} label="My Reviews" badge={null} onClick={() => {}} />);
    expect(screen.queryByLabelText(/^\d+ My Reviews$/)).toBeNull();
  });

  it("caps large counts at 99+", () => {
    render(<NavSubItem active={false} label="My Items" badge={250} onClick={() => {}} />);
    expect(screen.getByText("99+")).toBeTruthy();
  });
});
