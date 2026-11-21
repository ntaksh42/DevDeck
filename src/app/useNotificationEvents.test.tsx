import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/lib/azdoCommands";
import type { PullRequestNotificationEvent } from "@/lib/desktopNotifications";
import { useNotificationEvents } from "./useNotificationEvents";

const { handlers, showPr } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown) => void>(), showPr: vi.fn(),
}));
vi.mock("@/lib/desktopNotifications", () => ({
  showPullRequestNotificationEvent: showPr,
  showWorkItemNotificationEvent: vi.fn(), showSyncFailedNotificationEvent: vi.fn(),
}));
vi.mock("@/lib/tauriEvents", () => ({
  subscribeTauriEvent: (name: string, callback: (event: unknown) => void) => {
    handlers.set(name, callback);
    return () => handlers.delete(name);
  },
}));

afterEach(cleanup);
beforeEach(() => showPr.mockClear());

describe("PR notification summary navigation", () => {
  it.each([
    [["readyToMerge"], "myPullRequests"],
    [["readyToMerge", "reviewRequested"], "notifications"],
    [["reviewRequested"], "myReviews"],
  ] as const)("routes %j summaries to %s, including queued events", (kinds, view) => {
    const open = vi.fn();
    const settings = {} as AppSettings;
    const event = { items: kinds.map((kind) => ({ kind })) } as PullRequestNotificationEvent;
    const { rerender } = renderHook(({ loaded }) => useNotificationEvents(loaded ? settings : null, open), {
      initialProps: { loaded: false },
    });
    handlers.get("notifications:pull-requests")!(event);
    expect(showPr).not.toHaveBeenCalled();
    rerender({ loaded: true });
    showPr.mock.calls[0][2]();
    expect(open).toHaveBeenLastCalledWith(view);
    handlers.get("notifications:pull-requests")!(event);
    showPr.mock.calls[1][2]();
    expect(open).toHaveBeenLastCalledWith(view);
  });
});
