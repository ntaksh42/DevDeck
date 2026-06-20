import { beforeEach, describe, expect, it, vi } from "vitest";

const isPermissionGranted = vi.fn();
const requestPermission = vi.fn();
const sendNotification = vi.fn();
const onAction = vi.fn();
const isTauriRuntime = vi.fn();
const openExternalUrl = vi.fn();

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: () => isPermissionGranted(),
  requestPermission: () => requestPermission(),
  sendNotification: (options: unknown) => sendNotification(options),
  onAction: (cb: (notification: { id?: number }) => void) => onAction(cb),
}));
vi.mock("@/lib/runtime", () => ({ isTauriRuntime: () => isTauriRuntime() }));
vi.mock("@/lib/openExternal", () => ({
  openExternalUrl: (url: string) => openExternalUrl(url),
}));

import {
  showSyncFailedNotificationEvent,
  showWorkItemNotificationEvent,
} from "./desktopNotifications";
import type { AppSettings } from "@/lib/azdoCommands";

const settings = {
  desktopNotificationsEnabled: true,
  notificationContentPreviewEnabled: true,
} as AppSettings;

describe("sendTauriDesktopNotification click wiring", () => {
  // The module registers a single global `onAction` listener lazily, so the
  // captured callback is shared across tests in this file.
  let actionCb: ((notification: { id?: number }) => void) | undefined;

  beforeEach(() => {
    isPermissionGranted.mockReset().mockResolvedValue(true);
    requestPermission.mockReset();
    sendNotification.mockReset();
    isTauriRuntime.mockReset().mockReturnValue(true);
    openExternalUrl.mockReset();
    onAction.mockReset().mockImplementation((cb) => {
      actionCb = cb;
      return Promise.resolve({});
    });
  });

  it("opens the target url when the matching notification action fires", async () => {
    const result = await showWorkItemNotificationEvent(
      {
        organizationId: "org",
        organizationName: "Org",
        items: [
          {
            kind: "assigned",
            id: 42,
            title: "Fix bug",
            projectName: "Proj",
            state: null,
            previousState: null,
            assignedTo: null,
            webUrl: "https://dev.azure.com/org/_workitems/edit/42",
          },
        ],
      },
      settings,
    );

    expect(result).toBe("sent");
    // A click handler was registered, so onAction must be wired and the
    // notification must carry an id to correlate the click.
    expect(onAction).toHaveBeenCalled();
    const sent = sendNotification.mock.calls[0][0] as { id?: number };
    expect(typeof sent.id).toBe("number");

    // Simulate the OS click event for that notification id.
    actionCb?.({ id: sent.id });
    expect(openExternalUrl).toHaveBeenCalledWith(
      "https://dev.azure.com/org/_workitems/edit/42",
    );
  });

  it("opens the first item url when an aggregated summary notification is clicked", async () => {
    const items = Array.from({ length: 5 }, (_, index) => ({
      kind: "assigned" as const,
      id: index + 1,
      title: `Item ${index + 1}`,
      projectName: "Proj",
      state: null,
      previousState: null,
      assignedTo: null,
      webUrl: `https://dev.azure.com/org/_workitems/edit/${index + 1}`,
    }));

    const result = await showWorkItemNotificationEvent(
      { organizationId: "org", organizationName: "Org", items },
      settings,
    );

    expect(result).toBe("sent");
    // A single summary notification is sent for 4+ updates.
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const sent = sendNotification.mock.calls[0][0] as { id?: number };
    expect(typeof sent.id).toBe("number");

    actionCb?.({ id: sent.id });
    expect(openExternalUrl).toHaveBeenCalledWith(
      "https://dev.azure.com/org/_workitems/edit/1",
    );
  });

  it("ignores action events for unknown notification ids", async () => {
    await showWorkItemNotificationEvent(
      {
        organizationId: "org",
        organizationName: "Org",
        items: [
          {
            kind: "assigned",
            id: 1,
            title: "Item",
            projectName: "Proj",
            state: null,
            previousState: null,
            assignedTo: null,
            webUrl: "https://dev.azure.com/org/_workitems/edit/1",
          },
        ],
      },
      settings,
    );

    actionCb?.({ id: 999999 });
    expect(openExternalUrl).not.toHaveBeenCalled();
  });
});

describe("showSyncFailedNotificationEvent", () => {
  beforeEach(() => {
    isPermissionGranted.mockReset().mockResolvedValue(true);
    requestPermission.mockReset();
    sendNotification.mockReset();
    isTauriRuntime.mockReset().mockReturnValue(true);
    onAction.mockReset().mockResolvedValue({});
  });

  it("sends a failure notification with retry guidance and reason", async () => {
    const result = await showSyncFailedNotificationEvent(
      { consecutiveFailures: 3, retryInSecs: 1200, lastError: "503 unavailable" },
      settings,
    );

    expect(result).toBe("sent");
    const sent = sendNotification.mock.calls[0][0] as { title: string; body: string };
    expect(sent.title).toBe("Sync is failing");
    expect(sent.body).toContain("3 attempts");
    expect(sent.body).toContain("20 min");
    expect(sent.body).toContain("503 unavailable");
  });

  it("omits the error reason when content preview is disabled", async () => {
    const result = await showSyncFailedNotificationEvent(
      { consecutiveFailures: 3, retryInSecs: 600, lastError: "secret detail" },
      { ...settings, notificationContentPreviewEnabled: false } as AppSettings,
    );

    expect(result).toBe("sent");
    const sent = sendNotification.mock.calls[0][0] as { body: string };
    expect(sent.body).not.toContain("secret detail");
  });

  it("skips when desktop notifications are disabled", async () => {
    const result = await showSyncFailedNotificationEvent(
      { consecutiveFailures: 5, retryInSecs: 1800, lastError: null },
      { ...settings, desktopNotificationsEnabled: false } as AppSettings,
    );

    expect(result).toBe("skipped");
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
