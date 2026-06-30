import { describe, expect, it } from "vitest";
import type { AppSettings } from "@/lib/azdoCommands";
import { isWithinQuietHours } from "./quietHours";

function settings(enabled: boolean, start: string, end: string): AppSettings {
  return {
    quietHoursEnabled: enabled,
    quietHoursStart: start,
    quietHoursEnd: end,
  } as AppSettings;
}

function at(hour: number, minute: number): Date {
  return new Date(2026, 0, 1, hour, minute, 0);
}

describe("isWithinQuietHours", () => {
  it("never suppresses when disabled", () => {
    expect(isWithinQuietHours(settings(false, "22:00", "08:00"), at(23, 0))).toBe(false);
  });

  it("wraps an overnight window past midnight", () => {
    const overnight = settings(true, "22:00", "08:00");
    expect(isWithinQuietHours(overnight, at(23, 30))).toBe(true);
    expect(isWithinQuietHours(overnight, at(2, 0))).toBe(true);
    expect(isWithinQuietHours(overnight, at(22, 0))).toBe(true); // inclusive start
    expect(isWithinQuietHours(overnight, at(8, 0))).toBe(false); // exclusive end
    expect(isWithinQuietHours(overnight, at(12, 0))).toBe(false);
  });

  it("handles a same-day window", () => {
    const daytime = settings(true, "09:00", "17:00");
    expect(isWithinQuietHours(daytime, at(12, 0))).toBe(true);
    expect(isWithinQuietHours(daytime, at(8, 59))).toBe(false);
    expect(isWithinQuietHours(daytime, at(17, 0))).toBe(false);
  });

  it("treats equal bounds as an empty window", () => {
    expect(isWithinQuietHours(settings(true, "10:00", "10:00"), at(10, 0))).toBe(false);
  });

  it("never suppresses on unparseable bounds", () => {
    expect(isWithinQuietHours(settings(true, "nope", "08:00"), at(2, 0))).toBe(false);
    expect(isWithinQuietHours(settings(true, "22:00", "bad"), at(23, 0))).toBe(false);
  });

  it("defaults to the current time when now is omitted", () => {
    // Disabled, so the real clock value never matters for this assertion.
    expect(isWithinQuietHours(settings(false, "22:00", "08:00"))).toBe(false);
  });
});
