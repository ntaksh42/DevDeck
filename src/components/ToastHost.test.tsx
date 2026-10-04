import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearToasts, pushToast } from "@/lib/toast";

const retryToastsFlag = vi.fn();
vi.mock("@/features/settings/useExperimentalFlags", () => ({
  useExperimentalFlag: () => retryToastsFlag(),
}));

import { ToastHost } from "./ToastHost";

describe("ToastHost", () => {
  afterEach(() => {
    cleanup();
    act(() => clearToasts());
    retryToastsFlag.mockReset();
  });

  it("shows plain message toasts even when retryToasts is off", () => {
    retryToastsFlag.mockReturnValue(false);
    render(<ToastHost />);

    act(() => {
      pushToast("#12 の更新に失敗しました");
    });

    expect(screen.getByText("#12 の更新に失敗しました")).toBeTruthy();
  });

  it("hides retry toasts while retryToasts is off", () => {
    retryToastsFlag.mockReturnValue(false);
    render(<ToastHost />);

    act(() => {
      pushToast("vote failed", () => {});
    });

    expect(screen.queryByText("vote failed")).toBeNull();
  });

  it("shows retry toasts when retryToasts is on", () => {
    retryToastsFlag.mockReturnValue(true);
    render(<ToastHost />);

    act(() => {
      pushToast("vote failed", () => {});
    });

    expect(screen.getByText("vote failed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
