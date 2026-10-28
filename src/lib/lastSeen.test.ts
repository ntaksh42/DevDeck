import { beforeEach, describe, expect, it } from "vitest";
import {
  LAST_SEEN_LIMIT,
  LAST_SEEN_STORAGE_KEY,
  changedSince,
  fingerprintOf,
  markSeen,
} from "./lastSeen";

describe("lastSeen", () => {
  beforeEach(() => window.localStorage.clear());

  it("does not flag items that were never viewed", () => {
    expect(changedSince([{ key: "a", fingerprint: "1" }]).size).toBe(0);
  });

  it("flags an item only after its fingerprint changes from the viewed one", () => {
    markSeen("a", "1");
    expect(changedSince([{ key: "a", fingerprint: "1" }]).has("a")).toBe(false);
    expect(changedSince([{ key: "a", fingerprint: "2" }]).has("a")).toBe(true);
    markSeen("a", "2");
    expect(changedSince([{ key: "a", fingerprint: "2" }]).has("a")).toBe(false);
  });

  it("builds distinct fingerprints for distinct field values", () => {
    expect(fingerprintOf("a", 1, null)).not.toBe(fingerprintOf("a", 1, "x"));
    expect(fingerprintOf("ab", "c")).not.toBe(fingerprintOf("a", "bc"));
  });

  it("keeps only the newest entries once over the limit", () => {
    for (let i = 0; i <= LAST_SEEN_LIMIT; i += 1) {
      markSeen(`k${i}`, "f", new Date(2026, 0, 1, 0, 0, i));
    }
    const stored = JSON.parse(window.localStorage.getItem(LAST_SEEN_STORAGE_KEY) ?? "{}");
    expect(Object.keys(stored)).toHaveLength(LAST_SEEN_LIMIT);
    expect(stored.k0).toBeUndefined();
    expect(stored[`k${LAST_SEEN_LIMIT}`]).toBeDefined();
  });

  it("falls back to empty on corrupt storage", () => {
    window.localStorage.setItem(LAST_SEEN_STORAGE_KEY, "not json");
    expect(changedSince([{ key: "a", fingerprint: "1" }]).size).toBe(0);
  });
});
