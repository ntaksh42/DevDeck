import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorkItemFollowToggle } from "./WorkItemFollowToggle";

afterEach(cleanup);

describe("WorkItemFollowToggle", () => {
  it("reflects the unfollowed state and is keyboard-activatable", () => {
    const onToggle = vi.fn();
    render(<WorkItemFollowToggle isFollowed={false} onToggle={onToggle} />);

    const button = screen.getByRole("button", { name: "Follow this work item" });
    expect(button.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("reflects the followed state", () => {
    render(<WorkItemFollowToggle isFollowed onToggle={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Unfollow this work item" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("disables the button while a follow/unfollow mutation is pending", () => {
    const onToggle = vi.fn();
    render(<WorkItemFollowToggle isFollowed={false} onToggle={onToggle} pending />);

    const button = screen.getByRole("button", { name: "Follow this work item" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(button);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
