import { describe, expect, it } from "vitest";
import type { SyncState } from "@/lib/azdoCommands";
import { summarizeSyncStates } from "./SyncStatusIndicator";

function state(overrides: Partial<SyncState>): SyncState {
  return {
    scope: "prs:org",
    orgId: "org",
    lastSyncedAt: null,
    errorCount: 0,
    lastError: null,
    lastWarning: null,
    ...overrides,
  };
}

describe("summarizeSyncStates", () => {
  it("reports none when nothing has synced", () => {
    expect(summarizeSyncStates([])).toEqual({
      lastSyncedAt: null,
      status: "none",
      errorMessage: null,
    });
  });

  it("returns the most recent successful sync time", () => {
    const result = summarizeSyncStates([
      state({ lastSyncedAt: "2026-06-20T08:00:00Z" }),
      state({ scope: "work_items:org", lastSyncedAt: "2026-06-20T09:30:00Z" }),
    ]);
    expect(result.status).toBe("ok");
    expect(result.lastSyncedAt).toBe("2026-06-20T09:30:00Z");
  });

  it("flags a generic failure with its message", () => {
    const result = summarizeSyncStates([
      state({ lastSyncedAt: "2026-06-20T08:00:00Z" }),
      state({ scope: "commits:org", errorCount: 2, lastError: "500 server error" }),
    ]);
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("500 server error");
    // The last good sync time is still surfaced.
    expect(result.lastSyncedAt).toBe("2026-06-20T08:00:00Z");
  });

  it("distinguishes re-auth from a generic failure", () => {
    for (const message of [
      "401 Unauthorized",
      "failed to get access token",
      "please sign in again",
    ]) {
      const result = summarizeSyncStates([
        state({ errorCount: 1, lastError: message }),
      ]);
      expect(result.status).toBe("reauth");
    }
  });

  it("prefers a re-auth error over a generic one", () => {
    const result = summarizeSyncStates([
      state({ scope: "a", errorCount: 1, lastError: "503 unavailable" }),
      state({ scope: "b", errorCount: 1, lastError: "401 Unauthorized" }),
    ]);
    expect(result.status).toBe("reauth");
  });
});
