import { beforeEach, describe, expect, it } from "vitest";
import {
  FIELD_PRESETS_STORAGE_KEY,
  loadFieldPresets,
  MAX_FIELD_PRESETS,
  storeFieldPresets,
  type WorkItemFieldPreset,
} from "./fieldPresetsStorage";

function makePreset(id: string): WorkItemFieldPreset {
  return {
    id,
    name: `Preset ${id}`,
    fields: [{ referenceName: "System.State", label: "State", value: "Resolved" }],
  };
}

describe("fieldPresetsStorage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips presets", () => {
    const presets = [makePreset("a"), makePreset("b")];
    storeFieldPresets(presets);
    expect(loadFieldPresets()).toEqual(presets);
  });

  it("returns an empty list for missing or malformed data", () => {
    expect(loadFieldPresets()).toEqual([]);

    window.localStorage.setItem(FIELD_PRESETS_STORAGE_KEY, "not json");
    expect(loadFieldPresets()).toEqual([]);

    window.localStorage.setItem(FIELD_PRESETS_STORAGE_KEY, '{"name":"x"}');
    expect(loadFieldPresets()).toEqual([]);
  });

  it("drops invalid entries while keeping valid ones", () => {
    window.localStorage.setItem(
      FIELD_PRESETS_STORAGE_KEY,
      JSON.stringify([
        makePreset("ok"),
        { id: "no-fields", name: "Broken", fields: [] },
        { id: "no-name", name: "  ", fields: makePreset("x").fields },
        "garbage",
      ]),
    );
    expect(loadFieldPresets()).toEqual([makePreset("ok")]);
  });

  it("caps stored presets at the shortcut limit", () => {
    const presets = Array.from({ length: MAX_FIELD_PRESETS + 3 }, (_, index) =>
      makePreset(String(index)),
    );
    storeFieldPresets(presets);
    expect(loadFieldPresets()).toHaveLength(MAX_FIELD_PRESETS);
  });
});
