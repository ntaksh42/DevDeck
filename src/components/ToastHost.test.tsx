import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearToasts, pushToast, pushNotice, NOTICE_TOAST_MS } from "@/lib/toast";

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
    vi.useRealTimers();
  });

  it("keeps a message when Escape was handled elsewhere or belongs to the IME", () => {
    retryToastsFlag.mockReturnValue(false);
    render(<ToastHost />);
    act(() => {
      pushToast("Could not save");
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true }));
    });
    const handled = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    handled.preventDefault();
    act(() => {
      window.dispatchEvent(handled);
    });
    expect(screen.queryByText("Could not save")).toBeTruthy();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByText("Could not save")).toBeNull();
  });

  it("closes success notices on their own", () => {
    vi.useFakeTimers();
    retryToastsFlag.mockReturnValue(false);
    render(<ToastHost />);
    act(() => {
      pushNotice("Reminder cancelled");
    });
    act(() => vi.advanceTimersByTime(NOTICE_TOAST_MS));
    expect(screen.queryByText("Reminder cancelled")).toBeNull();
  });

  it("dismisses timed messages after five seconds and keeps untimed errors", () => {
    vi.useFakeTimers();
    retryToastsFlag.mockReturnValue(false);
    render(<ToastHost />);
    act(() => {
      pushToast("Investigation requested", undefined, 5000);
      pushToast("Investigation failed");
    });
    act(() => vi.advanceTimersByTime(4999));
    expect(screen.queryByText("Investigation requested")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Investigation requested")).toBeNull();
    expect(screen.queryByText("Investigation failed")).toBeTruthy();
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
