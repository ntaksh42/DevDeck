import { describe, expect, it } from "vitest";
import {
  demoListNotifications,
  demoMarkAllNotificationsRead,
  demoMarkNotificationsRead,
  demoRecordNotification,
  demoUnreadNotificationsCount,
} from "./notifications";

describe("demo notification history", () => {
  it("lists seeded notifications covering every known kind", () => {
    const { items } = demoListNotifications({ limit: 100 });
    const kinds = new Set(items.map((n) => n.kind));
    expect(items.length).toBeGreaterThanOrEqual(10);
    expect(kinds).toEqual(
      new Set([
        "prReviewRequested",
        "prVoteReset",
        "prCommentReply",
        "wiAssigned",
        "wiStateChanged",
        "syncFailed",
        "pipelineWatchStarted",
        "pipelineWatchFinished",
        "pipelineRunQueued",
      ]),
    );
  });

  it("paginates with a beforeId cursor in descending id order", () => {
    const first = demoListNotifications({ limit: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    const ids = first.items.map((n) => n.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));

    const lastId = first.items[first.items.length - 1].id;
    const second = demoListNotifications({ limit: 3, beforeId: lastId });
    expect(second.items.every((n) => n.id < lastId)).toBe(true);
    expect(second.items.some((n) => first.items.some((f) => f.id === n.id))).toBe(false);
  });

  it("filters by unreadOnly and by kinds", () => {
    const all = demoListNotifications({ limit: 100 }).items;
    const unread = demoListNotifications({ limit: 100, unreadOnly: true }).items;
    expect(unread.length).toBeGreaterThan(0);
    expect(unread.every((n) => !n.isRead)).toBe(true);
    expect(unread.length).toBeLessThan(all.length);

    const wiOnly = demoListNotifications({
      limit: 100,
      kinds: ["wiAssigned", "wiStateChanged"],
    }).items;
    expect(wiOnly.length).toBeGreaterThan(0);
    expect(wiOnly.every((n) => n.kind === "wiAssigned" || n.kind === "wiStateChanged")).toBe(true);
  });

  it("filters by organizationId", () => {
    const scoped = demoListNotifications({ limit: 100, organizationId: "contoso" }).items;
    const other = demoListNotifications({ limit: 100, organizationId: "no-such-org" }).items;
    expect(scoped.length).toBeGreaterThan(0);
    expect(other).toHaveLength(0);
  });

  it("marks specific notifications read and updates the unread count", () => {
    const target = demoListNotifications({ limit: 100, unreadOnly: true }).items[0];
    const before = demoUnreadNotificationsCount();
    demoMarkNotificationsRead([target.id]);
    expect(demoUnreadNotificationsCount()).toBe(before - 1);
    const refreshed = demoListNotifications({ limit: 100 }).items.find((n) => n.id === target.id);
    expect(refreshed?.isRead).toBe(true);
  });

  it("marks all notifications read", () => {
    demoMarkAllNotificationsRead();
    expect(demoUnreadNotificationsCount()).toBe(0);
  });

  it("records a new notification as unread and surfaces it in listings", () => {
    const beforeCount = demoListNotifications({ limit: 100 }).items.length;
    demoRecordNotification({
      organizationId: "contoso",
      kind: "prCommentReply",
      title: "New reply",
      body: "test body",
      payload: {
        pullRequestId: 1,
        repositoryId: "r",
        repositoryName: "r",
        projectName: "p",
        webUrl: null,
        commentAuthor: "x",
        snippet: "y",
      },
    });

    const after = demoListNotifications({ limit: 100 });
    expect(after.items.length).toBe(beforeCount + 1);
    expect(after.items[0].title).toBe("New reply");
    expect(after.items[0].isRead).toBe(false);
    expect(demoUnreadNotificationsCount()).toBe(1);
  });
});
