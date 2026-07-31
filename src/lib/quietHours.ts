import type { AppSettings } from "@/lib/azdoCommands";

// Whether the given local time falls inside the configured quiet-hours window.
// Returns false when disabled, when either bound is unparseable, or when the
// bounds are equal (an empty window) so a misconfiguration never mutes forever.
export function isWithinQuietHours(settings: AppSettings, now: Date = new Date()): boolean {
  if (!settings.quietHoursEnabled) {
    return false;
  }
  const start = parseHHMM(settings.quietHoursStart);
  const end = parseHHMM(settings.quietHoursEnd);
  if (start === null || end === null || start === end) {
    return false;
  }
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (start < end) {
    return minutes >= start && minutes < end;
  }
  // Overnight window wraps past midnight.
  return minutes >= start || minutes < end;
}

// Parses a "HH:MM" string into minutes-since-midnight, or null if invalid.
function parseHHMM(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}
