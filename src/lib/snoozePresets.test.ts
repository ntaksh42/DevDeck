import { describe, expect, it } from "vitest";
import {
  SNOOZE_PRESETS,
  localInputToIso,
  presetToIso,
} from "./snoozePresets";

function preset(id: string) {
  const found = SNOOZE_PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`missing preset ${id}`);
  return found;
}

describe("snooze presets", () => {
  it("tonight lands at 18:00 local, rolling to tomorrow when already past", () => {
    const morning = new Date("2026-06-17T08:00:00");
    const tonight = new Date(presetToIso(preset("tonight"), morning));
    expect(tonight.getHours()).toBe(18);
    expect(tonight.getDate()).toBe(17);

    const evening = new Date("2026-06-17T20:00:00");
    const rolled = new Date(presetToIso(preset("tonight"), evening));
    expect(rolled.getHours()).toBe(18);
    expect(rolled.getDate()).toBe(18);
  });

  it("tomorrow morning lands at 09:00 next day", () => {
    const now = new Date("2026-06-17T15:00:00");
    const result = new Date(presetToIso(preset("tomorrow"), now));
    expect(result.getDate()).toBe(18);
    expect(result.getHours()).toBe(9);
  });

  it("next Monday is always in the future", () => {
    // 2026-06-15 is a Monday; the preset should skip to the following Monday.
    const monday = new Date("2026-06-15T10:00:00");
    const result = new Date(presetToIso(preset("next-week"), monday));
    expect(result.getDay()).toBe(1);
    expect(result.getTime()).toBeGreaterThan(monday.getTime());
    expect(result.getDate()).toBe(22);
  });

  it("one month later preserves the day or clamps to month end", () => {
    const regular = new Date("2026-06-17T15:00:00");
    const regularResult = new Date(presetToIso(preset("in-one-month"), regular));
    expect(regularResult.getMonth()).toBe(6);
    expect(regularResult.getDate()).toBe(17);
    expect(regularResult.getHours()).toBe(9);

    const monthEnd = new Date("2026-01-31T15:00:00");
    const monthEndResult = new Date(presetToIso(preset("in-one-month"), monthEnd));
    expect(monthEndResult.getMonth()).toBe(1);
    expect(monthEndResult.getDate()).toBe(28);
  });

  it("localInputToIso rejects empty and invalid input", () => {
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("not-a-date")).toBeNull();
    expect(localInputToIso("2026-06-20T09:00")).not.toBeNull();
  });
});
