import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorState } from "./StateDisplay";
import { OPEN_SETTINGS_EVENT } from "@/lib/crossLinks";

afterEach(cleanup);

describe("ErrorState", () => {
  it("offers a re-authentication path for unauthorized errors via the code prop", () => {
    const handler = vi.fn();
    window.addEventListener(OPEN_SETTINGS_EVENT, handler);

    render(<ErrorState message="Something went wrong" code="unauthorized" />);

    const button = screen.getByRole("button", { name: /Re-authenticate in Settings/ });
    fireEvent.click(button);

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_SETTINGS_EVENT, handler);
  });

  it("does not show the re-auth button for unrelated errors", () => {
    render(<ErrorState message="Network connection failed" />);
    expect(
      screen.queryByRole("button", { name: /Re-authenticate in Settings/ }),
    ).toBeNull();
  });

  it("classifies 401 from the message even without a code (back-compat)", () => {
    render(<ErrorState message="Azure DevOps authentication failed." />);
    expect(
      screen.getByRole("button", { name: /Re-authenticate in Settings/ }),
    ).toBeTruthy();
  });
});
