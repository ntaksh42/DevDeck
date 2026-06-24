import { afterEach, describe, expect, it } from "vitest";
import {
  markWorkItemRead,
  reconcileUnread,
  seedDemoUnread,
  workItemUnreadKey,
} from "./workItemUnreadTracking";

afterEach(() => window.localStorage.clear());

const A = workItemUnreadKey("contoso", 1);

describe("reconcileUnread", () => {
  it("treats a newly-seen item as read (baseline), not unread", () => {
    const unread = reconcileUnread([{ key: A, changedDate: "2026-06-01T00:00:00Z" }]);
    expect(unread.has(A)).toBe(false);
  });

  it("flags an item that changed since it was first seen", () => {
    reconcileUnread([{ key: A, changedDate: "2026-06-01T00:00:00Z" }]);
    const unread = reconcileUnread([{ key: A, changedDate: "2026-06-05T00:00:00Z" }]);
    expect(unread.has(A)).toBe(true);
  });

  it("stays unread across reconciles until opened", () => {
    reconcileUnread([{ key: A, changedDate: "2026-06-01T00:00:00Z" }]);
    reconcileUnread([{ key: A, changedDate: "2026-06-05T00:00:00Z" }]);
    expect(reconcileUnread([{ key: A, changedDate: "2026-06-05T00:00:00Z" }]).has(A)).toBe(true);
  });

  it("ignores items without a changed date", () => {
    expect(reconcileUnread([{ key: A, changedDate: null }]).size).toBe(0);
  });

  it("prunes tracking for items no longer present", () => {
    reconcileUnread([{ key: A, changedDate: "2026-06-01T00:00:00Z" }]);
    reconcileUnread([{ key: A, changedDate: "2026-06-05T00:00:00Z" }]);
    const B = workItemUnreadKey("contoso", 2);
    // A gone; B is new -> baseline, not unread.
    expect(reconcileUnread([{ key: B, changedDate: "2026-06-05T00:00:00Z" }]).size).toBe(0);
  });
});

describe("markWorkItemRead", () => {
  it("clears unread after opening", () => {
    reconcileUnread([{ key: A, changedDate: "2026-06-01T00:00:00Z" }]);
    reconcileUnread([{ key: A, changedDate: "2026-06-05T00:00:00Z" }]);
    markWorkItemRead(A, "2026-06-05T00:00:00Z");
    expect(reconcileUnread([{ key: A, changedDate: "2026-06-05T00:00:00Z" }]).has(A)).toBe(false);
  });
});

describe("seedDemoUnread", () => {
  it("makes an item unread by seeding an older seen stamp", () => {
    seedDemoUnread(A, "2000-01-01T00:00:00Z");
    expect(reconcileUnread([{ key: A, changedDate: "2026-06-05T00:00:00Z" }]).has(A)).toBe(true);
  });

  it("never overrides existing tracking", () => {
    reconcileUnread([{ key: A, changedDate: "2026-06-05T00:00:00Z" }]); // baseline seen
    seedDemoUnread(A, "2000-01-01T00:00:00Z");
    expect(reconcileUnread([{ key: A, changedDate: "2026-06-05T00:00:00Z" }]).has(A)).toBe(false);
  });
});
