import { beforeEach, describe, expect, it } from "vitest";
import type { AppSettings } from "./azdoCommands";
import {
  APP_SETTINGS_KEY,
  BACKUP_GROUPS,
  BACKUP_VERSION,
  applyBackup,
  buildBackup,
  notificationBackupValue,
  notificationPatch,
  parseBackup,
} from "./settingsBackup";

const ALL = BACKUP_GROUPS.map((group) => group.id);

beforeEach(() => window.localStorage.clear());

describe("settings backup", () => {
  it("exports only allowlisted keys, never credentials or paths", () => {
    window.localStorage.setItem("azdodeck:org:contoso:pat", "secret-token");
    window.localStorage.setItem("azdodeck:resultFolder", "C:\\Users\\me");
    window.localStorage.setItem("azdodeck:keybindings:v1", JSON.stringify({ toggleAgent: "Ctrl+L" }));

    const text = JSON.stringify(buildBackup(ALL));
    expect(text).toContain("Ctrl+L");
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("Users");
  });

  it("restores exported settings after the originals are lost", () => {
    window.localStorage.setItem("azdodeck:keybindings:v1", JSON.stringify({ toggleAgent: "Ctrl+L" }));
    window.localStorage.setItem("azdodeck:quickPipelines", JSON.stringify([{ id: "a" }]));
    window.localStorage.setItem("azdodeck:theme", "dark");
    const text = JSON.stringify(buildBackup(ALL));

    window.localStorage.clear();
    const modes = Object.fromEntries(ALL.map((id) => [id, "overwrite" as const]));
    expect(applyBackup(parseBackup(text), modes)).toBe(3);
    expect(window.localStorage.getItem("azdodeck:keybindings:v1")).toBe('{"toggleAgent":"Ctrl+L"}');
    expect(window.localStorage.getItem("azdodeck:theme")).toBe("dark");
  });

  it("skips unchosen groups and merges arrays by id", () => {
    window.localStorage.setItem("azdodeck:quickPipelines", JSON.stringify([{ id: "a", n: 1 }]));
    window.localStorage.setItem("azdodeck:theme", "dark");
    const backup = parseBackup(
      JSON.stringify({
        app: "devdeck",
        version: BACKUP_VERSION,
        exportedAt: "",
        groups: {
          quickPipelines: { "azdodeck:quickPipelines": JSON.stringify([{ id: "a", n: 2 }, { id: "b" }]) },
          display: { "azdodeck:theme": "light" },
        },
      }),
    );
    applyBackup(backup, { quickPipelines: "merge", display: "skip" });
    expect(JSON.parse(window.localStorage.getItem("azdodeck:quickPipelines")!)).toEqual([
      { id: "a", n: 1 },
      { id: "b" },
    ]);
    expect(window.localStorage.getItem("azdodeck:theme")).toBe("dark");
  });

  it.each([
    ["not JSON", "{oops", /not valid JSON/],
    ["another app", JSON.stringify({ app: "x", version: 1, groups: {} }), /not a DevDeck/],
    ["a future version", JSON.stringify({ app: "devdeck", version: 99, groups: {} }), /newer DevDeck/],
    [
      "a wrong value shape",
      JSON.stringify({
        app: "devdeck",
        version: 1,
        groups: { keybindings: { "azdodeck:keybindings:v1": "[1,2]" } },
      }),
      /invalid value/,
    ],
  ])("rejects %s", (_name, text, message) => {
    expect(() => parseBackup(text)).toThrow(message);
  });

  it("ignores keys that are not in the allowlist", () => {
    const backup = parseBackup(
      JSON.stringify({
        app: "devdeck",
        version: 1,
        groups: { keybindings: { "azdodeck:org:contoso:pat": "x", "azdodeck:keybindings:v1": "{}" } },
      }),
    );
    expect(backup.groups.keybindings).toEqual({ "azdodeck:keybindings:v1": "{}" });
  });

  describe("notification group", () => {
    const rule = (project: string) => ({ types: ["reviewRequested"], projects: [project], repositories: [], mute: true });
    const settings = {
      notificationRules: [rule("A")],
      notificationContentPreviewEnabled: false,
      notifyWorkItemAssignments: true,
      notifyWorkItemStateChanges: true,
      notifyPrReviewRequests: true,
      notifyPrVoteResets: true,
      notifyPrCommentReplies: true,
      quietHoursEnabled: true,
      quietHoursStart: "21:00",
      quietHoursEnd: "07:00",
      desktopNotificationsEnabled: true,
      reviewResultFolderPath: "C:/secret/path",
    } as unknown as AppSettings;

    it("exports the rules and quiet hours but not machine-specific settings", () => {
      const raw = notificationBackupValue(settings);
      expect(raw).toContain("quietHoursStart");
      expect(raw).not.toContain("C:/secret/path");
      expect(raw).not.toContain("desktopNotificationsEnabled");
      const backup = buildBackup(["notifications"], new Date(), { [APP_SETTINGS_KEY]: raw });
      expect(backup.groups.notifications[APP_SETTINGS_KEY]).toBe(raw);
    });

    it("overwrite takes the file's values; merge only adds rules that are missing", () => {
      const raw = JSON.stringify({ notificationRules: [rule("A"), rule("B")], quietHoursStart: "22:00" });
      expect(notificationPatch(settings, raw, "overwrite")).toEqual({
        notificationRules: [rule("A"), rule("B")],
        quietHoursStart: "22:00",
      });
      expect(notificationPatch(settings, raw, "merge")).toEqual({
        notificationRules: [rule("A"), rule("B")],
      });
    });

    it("drops unknown fields from an imported file", () => {
      const raw = JSON.stringify({ quietHoursEnd: "06:00", reviewResultFolderPath: "C:/x" });
      expect(notificationPatch(settings, raw, "overwrite")).toEqual({ quietHoursEnd: "06:00" });
    });
  });
});
