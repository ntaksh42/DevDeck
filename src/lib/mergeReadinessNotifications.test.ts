import { beforeEach, describe, expect, it, vi } from "vitest";
import { appSettingsSchema } from "./commands/orgs";
import { resolveNotificationJump } from "@/features/notifications/notificationJump";
import { notificationKindLabel } from "@/features/notifications/notificationKinds";
import { showPullRequestNotificationEvent, type PullRequestNotificationEvent } from "./desktopNotifications";

const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: async () => true,
  onAction: async () => () => {},
  requestPermission: async () => "granted",
  sendNotification,
}));
vi.mock("./runtime", () => ({ isTauriRuntime: () => true }));

const event: PullRequestNotificationEvent = {
  organizationId: "org", organizationName: "Org", items: [{
    kind: "readyToMerge", pullRequestId: 42, repositoryId: "repo", repositoryName: "Repo",
    projectName: "Project", title: "Merge me", webUrl: null, commentAuthor: null, snippet: null,
  }],
};
const settings = appSettingsSchema.parse({ reviewResultFolderPath: null, desktopNotificationsEnabled: true });

beforeEach(() => sendNotification.mockClear());

describe("merge readiness notifications", () => {
  it("sends the ready-to-merge title and respects quiet hours and the master switch", async () => {
    expect(await showPullRequestNotificationEvent(event, settings)).toBe("sent");
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ title: "Ready to merge: !42" }));
    sendNotification.mockClear();
    expect(await showPullRequestNotificationEvent(event, { ...settings, desktopNotificationsEnabled: false })).toBe("skipped");
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 23));
    expect(await showPullRequestNotificationEvent(event, { ...settings, quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "08:00" })).toBe("skipped");
    vi.useRealTimers();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("labels the history entry and resolves keyboard/click navigation to the PR", () => {
    expect(notificationKindLabel("prReadyToMerge")).toBe("Ready to merge");
    expect(resolveNotificationJump({ id: 1, createdAt: "2026-01-01", organizationId: "org",
      kind: "prReadyToMerge", title: "Ready", body: null, isRead: false,
      payload: { pullRequestId: 42, repositoryId: "repo" },
    })).toEqual({ type: "pullRequest", pullRequestId: 42, organizationId: "org" });
  });
});
