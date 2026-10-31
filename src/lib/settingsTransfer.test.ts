import { beforeEach, describe, expect, it } from "vitest";
import {
  applySettingsImport,
  buildSettingsExport,
  isTransferableKey,
  parseSettingsImport,
} from "./settingsTransfer";

describe("isTransferableKey", () => {
  it("allows layout, view and key-binding settings", () => {
    expect(isTransferableKey("azdodeck:layout:sidebarWidth")).toBe(true);
    expect(isTransferableKey("azdodeck:keybindings:v1")).toBe(true);
    expect(isTransferableKey("azdodeck:workItemViews")).toBe(true);
    expect(isTransferableKey("azdodeck:theme")).toBe(true);
  });

  it("refuses history, tracking and unknown keys", () => {
    expect(isTransferableKey("azdodeck:lastSeen:v1")).toBe(false);
    expect(isTransferableKey("azdodeck:myReviews:returnTracking:v1")).toBe(false);
    expect(isTransferableKey("azdodeck:t:searchHistory")).toBe(false);
    expect(isTransferableKey("other:layout:x")).toBe(false);
  });

  it("refuses credential-looking keys even under an allowed prefix", () => {
    expect(isTransferableKey("azdodeck:layout:pat")).toBe(false);
    expect(isTransferableKey("azdodeck:view:apiToken")).toBe(false);
    expect(isTransferableKey("azdodeck:org:contoso:azure-cli")).toBe(false);
  });
});

describe("export / import round trip", () => {
  beforeEach(() => window.localStorage.clear());

  it("exports only transferable entries", () => {
    window.localStorage.setItem("azdodeck:layout:sidebarWidth", "280");
    window.localStorage.setItem("azdodeck:lastSeen:v1", "{}");
    window.localStorage.setItem("azdodeck:org:contoso:pat", "secret");
    const doc = buildSettingsExport(window.localStorage, new Date("2026-01-01T00:00:00Z"));
    expect(doc.entries).toEqual({ "azdodeck:layout:sidebarWidth": "280" });
    expect(doc.exportedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("imports a valid export and skips unsafe keys", () => {
    const text = JSON.stringify({
      app: "devdeck",
      version: 1,
      entries: {
        "azdodeck:layout:sidebarWidth": "300",
        "azdodeck:org:x:pat": "leak",
        "azdodeck:view:n": 5,
      },
    });
    const parsed = parseSettingsImport(text);
    expect(parsed).toEqual({
      ok: true,
      entries: { "azdodeck:layout:sidebarWidth": "300" },
      skipped: 2,
    });
    if (parsed.ok) expect(applySettingsImport(parsed.entries)).toBe(1);
    expect(window.localStorage.getItem("azdodeck:layout:sidebarWidth")).toBe("300");
    expect(window.localStorage.getItem("azdodeck:org:x:pat")).toBeNull();
  });

  it("rejects malformed documents", () => {
    expect(parseSettingsImport("nope").ok).toBe(false);
    expect(parseSettingsImport("[]").ok).toBe(false);
    expect(parseSettingsImport(JSON.stringify({ app: "other", version: 1, entries: {} })).ok).toBe(false);
    expect(parseSettingsImport(JSON.stringify({ app: "devdeck", version: 2, entries: {} })).ok).toBe(false);
    expect(parseSettingsImport(JSON.stringify({ app: "devdeck", version: 1 })).ok).toBe(false);
  });
});
