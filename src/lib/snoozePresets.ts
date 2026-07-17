// Snooze deadline presets, computed in the user's local time and returned as
// UTC ISO8601 strings for the backend. "Tonight" and "Tomorrow morning" snap to
// fixed local hours; the rest are relative offsets.

export type SnoozePreset = {
  id: string;
  label: string;
  compute: (now: Date) => Date;
};

function atLocalHour(now: Date, dayOffset: number, hour: number): Date {
  const result = new Date(now);
  result.setDate(result.getDate() + dayOffset);
  result.setHours(hour, 0, 0, 0);
  return result;
}

function oneMonthLater(now: Date): Date {
  const result = new Date(now);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + 1);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  result.setHours(9, 0, 0, 0);
  return result;
}

// Days until the next Monday (1-7); today-if-Monday rolls to next week so the
// snooze always lands in the future.
function daysUntilNextMonday(now: Date): number {
  const day = now.getDay(); // 0 = Sunday
  const delta = (8 - day) % 7;
  return delta === 0 ? 7 : delta;
}

export const SNOOZE_PRESETS: SnoozePreset[] = [
  {
    id: "tonight",
    label: "Tonight (18:00)",
    compute: (now) => {
      const tonight = atLocalHour(now, 0, 18);
      return tonight.getTime() > now.getTime() ? tonight : atLocalHour(now, 1, 18);
    },
  },
  {
    id: "tomorrow",
    label: "Tomorrow morning (09:00)",
    compute: (now) => atLocalHour(now, 1, 9),
  },
  {
    id: "in-three-days",
    label: "In 3 days",
    compute: (now) => atLocalHour(now, 3, 9),
  },
  {
    id: "next-week",
    label: "Next Monday (09:00)",
    compute: (now) => atLocalHour(now, daysUntilNextMonday(now), 9),
  },
  {
    id: "in-one-month",
    label: "In 1 month",
    compute: oneMonthLater,
  },
];

export function presetToIso(preset: SnoozePreset, now: Date = new Date()): string {
  return preset.compute(now).toISOString();
}

// Converts a value from a `datetime-local` input (local wall-clock, no zone)
// into a UTC ISO8601 string. Returns null when the value is empty or invalid.
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function formatSnoozeUntil(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
