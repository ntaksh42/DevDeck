import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  KEYBINDINGS_STORAGE_KEY,
  comboFromEvent,
  defaultKeybindingMap,
  findConflicts,
  loadKeybindingOverrides,
  matchesCombo,
  resolveKeybindings,
  saveKeybindingOverrides,
} from "./keybindings";

function evt(
  key: string,
  mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {},
) {
  return {
    key,
    ctrlKey: mods.ctrlKey ?? false,
    altKey: mods.altKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    metaKey: mods.metaKey ?? false,
  };
}

describe("keybindings registry", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("resolves to defaults when there are no overrides", () => {
    expect(resolveKeybindings()).toEqual(defaultKeybindingMap());
  });

  it("applies stored overrides and falls back to defaults for the rest", () => {
    saveKeybindingOverrides({ commandPalette: "Ctrl+J" });
    const map = resolveKeybindings();
    expect(map.commandPalette).toBe("Ctrl+J");
    expect(map.focusGrid).toBe("Ctrl+G"); // unchanged default
  });

  it("does not persist values equal to the default", () => {
    saveKeybindingOverrides({ commandPalette: "Ctrl+K", focusGrid: "Alt+X" });
    const stored = JSON.parse(window.localStorage.getItem(KEYBINDINGS_STORAGE_KEY) ?? "{}");
    expect(stored).toEqual({ focusGrid: "Alt+X" });
  });

  it("clears storage when all overrides match defaults", () => {
    saveKeybindingOverrides({ focusGrid: "Alt+X" });
    saveKeybindingOverrides({ focusGrid: "Ctrl+G" });
    expect(window.localStorage.getItem(KEYBINDINGS_STORAGE_KEY)).toBeNull();
  });

  it("ignores reserved bindings in overrides", () => {
    saveKeybindingOverrides({ gotoLeader: "H" });
    expect(loadKeybindingOverrides().gotoLeader).toBeUndefined();
    expect(resolveKeybindings().gotoLeader).toBe("G");
  });

  it("tolerates corrupt storage", () => {
    window.localStorage.setItem(KEYBINDINGS_STORAGE_KEY, "{not json");
    expect(loadKeybindingOverrides()).toEqual({});
    expect(resolveKeybindings()).toEqual(defaultKeybindingMap());
  });
});

describe("matchesCombo", () => {
  it("matches a Ctrl combo, treating Meta as Ctrl", () => {
    expect(matchesCombo("Ctrl+K", evt("k", { ctrlKey: true }))).toBe(true);
    expect(matchesCombo("Ctrl+K", evt("k", { metaKey: true }))).toBe(true);
    expect(matchesCombo("Ctrl+K", evt("k"))).toBe(false);
  });

  it("requires the exact Alt modifier", () => {
    expect(matchesCombo("Alt+G", evt("g", { altKey: true }))).toBe(true);
    expect(matchesCombo("Alt+G", evt("g"))).toBe(false);
    expect(matchesCombo("Alt+G", evt("g", { altKey: true, ctrlKey: true }))).toBe(false);
  });

  it("matches printable single keys without enforcing shift", () => {
    expect(matchesCombo("?", evt("?", { shiftKey: true }))).toBe(true);
    expect(matchesCombo("?", evt("?"))).toBe(true);
  });

  it("matches the comma settings binding", () => {
    expect(matchesCombo("Ctrl+,", evt(",", { ctrlKey: true }))).toBe(true);
  });
});

describe("comboFromEvent", () => {
  it("builds modifier combos", () => {
    expect(comboFromEvent(evt("k", { ctrlKey: true }))).toBe("Ctrl+K");
    expect(comboFromEvent(evt("g", { altKey: true }))).toBe("Alt+G");
  });

  it("returns null while only modifiers are held", () => {
    expect(comboFromEvent(evt("Control", { ctrlKey: true }))).toBeNull();
  });

  it("drops a lone Shift for printable characters", () => {
    expect(comboFromEvent(evt("?", { shiftKey: true }))).toBe("?");
  });
});

describe("findConflicts", () => {
  it("flags two global bindings sharing a combo", () => {
    const map = defaultKeybindingMap();
    map.focusGrid = "Ctrl+K"; // same as commandPalette
    const conflicts = findConflicts(map);
    expect(conflicts.get("focusGrid")).toContain("commandPalette");
    expect(conflicts.get("commandPalette")).toContain("focusGrid");
  });

  it("does not flag identical keys in different scopes", () => {
    const map = defaultKeybindingMap();
    // global gotoSettings "S" lives in the goto scope; no global binding
    // collides with another global binding -> no conflict.
    expect(findConflicts(map).size).toBe(0);
  });

  it("flags duplicate goto keys", () => {
    const map = defaultKeybindingMap();
    map.gotoCommits = map.gotoMyReviews; // both "R"
    const conflicts = findConflicts(map);
    expect(conflicts.get("gotoCommits")).toContain("gotoMyReviews");
  });
});
