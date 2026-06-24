import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorState } from "./StateDisplay";

describe("ErrorState actions", () => {
  afterEach(cleanup);

  it("offers Open Settings for an auth error", () => {
    const onOpenSettings = vi.fn();
    render(
      <ErrorState
        message="Authentication failed (status 401)"
        onOpenSettings={onOpenSettings}
        onRetry={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("offers Try again for a network error", () => {
    const onRetry = vi.fn();
    render(<ErrorState message="network error: connection reset" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders message only when no handlers are provided", () => {
    render(<ErrorState message="something broke" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
