import { describe, expect, it } from "vitest";
import { appSettingsSchema, type AppSettings } from "@/lib/azdoCommands";
import { settingsInput } from "./settingsHelpers";

// `update_app_settings` is a full replace: the Rust side's
// `normalize_app_settings` reads each field as an `Option` and falls back to
// that field's default when it is absent. Every settings section therefore has
// to send the *whole* object, which it does by funnelling its own patch through
// `settingsInput()`.
//
// That makes `settingsInput()` a list of fields kept in sync by hand, and a
// field missing from it is silently reset to its default every time an
// unrelated section is saved. Rather than assert one field at a time, these
// tests enumerate the schema at runtime so a newly added setting is covered
// without anyone remembering to extend them.

/** A settings object whose every value differs from that field's default. */
function nonDefaultSettings(): AppSettings {
  return {
    reviewResultFolderPath: "C:/reviews",
    workItemResultFolderPath: "C:/work-items",
    showWindowHotkey: "Ctrl+Shift+D",
    readOnlyValidationModeEnabled: true,
    desktopNotificationsEnabled: true,
    notificationContentPreviewEnabled: false,
    notifyWorkItemAssignments: false,
    notifyWorkItemStateChanges: false,
    notifyPrReviewRequests: false,
    notifyPrVoteResets: false,
    notifyPrCommentReplies: false,
    reviewStaleThresholdDays: 42,
    workItemStaleThresholdDays: 43,
    notificationRules: [
      {
        types: ["reviewRequested"],
        projects: ["Platform"],
        repositories: ["infra"],
        mute: true,
      },
    ],
    experimentalFeaturesEnabled: true,
    experimentalUsageStats: true,
    experimentalRetryToasts: true,
    experimentalDiagnosticsExport: true,
    experimentalCrossOrgSummary: true,
    experimentalAutoUpdateCheck: true,
  };
}

describe("settingsInput", () => {
  it("covers every field of AppSettings", () => {
    // Guards the fixture above, so a new setting cannot slip past the
    // round-trip test below by simply being absent from it.
    const schemaKeys = Object.keys(appSettingsSchema.shape).sort();
    const fixtureKeys = Object.keys(nonDefaultSettings()).sort();
    expect(fixtureKeys).toEqual(schemaKeys);
  });

  it("carries every stored field forward when an unrelated field is patched", () => {
    const stored = nonDefaultSettings();
    // A patch touching exactly one field, as each settings section sends.
    const sent = settingsInput(stored, { readOnlyValidationModeEnabled: false });

    for (const key of Object.keys(appSettingsSchema.shape) as (keyof AppSettings)[]) {
      if (key === "readOnlyValidationModeEnabled") continue;
      expect(sent[key], `settingsInput() dropped "${key}"`).toEqual(stored[key]);
    }
    expect(sent.readOnlyValidationModeEnabled).toBe(false);
  });

  it("falls back to each field's default when no settings are loaded yet", () => {
    // The settings query can still be in flight when a section saves, so
    // `settings` is undefined; the result must still be a complete object
    // rather than one with holes the backend would read as "reset me".
    const sent = settingsInput(undefined, { desktopNotificationsEnabled: true });
    const schemaKeys = Object.keys(appSettingsSchema.shape).sort();
    expect(Object.keys(sent).sort()).toEqual(schemaKeys);
  });
});
