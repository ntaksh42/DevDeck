// Resolves a group's range settings into the bucket list every panel shares.
//
// Kept apart from analyzeDateRange.ts so that file stays about calendar maths
// and this one about the user's choice of window.

import {
  analyzeBuckets,
  analyzeBucketsBetween,
  monthRange,
  type AnalyzeBucket,
} from "./analyzeDateRange";
import type { AnalyzeGranularity, AnalyzeRangePreset } from "./analyzeGroupsStorage";

export type AnalyzeRangeSettings = {
  granularity: AnalyzeGranularity;
  rangeCount: number;
  rangePreset: AnalyzeRangePreset;
  rangeFrom: string;
  rangeTo: string;
};

export const RANGE_PRESET_LABELS: Record<AnalyzeRangePreset, string> = {
  count: "直近",
  thisMonth: "今月",
  lastMonth: "先月",
  custom: "カスタム",
};

/**
 * The buckets a group should display.
 *
 * A custom range that is not filled in yet falls back to the counted window so
 * the view never goes blank while the user is still picking dates.
 */
export function resolveAnalyzeBuckets(
  settings: AnalyzeRangeSettings,
  now: Date = new Date(),
): AnalyzeBucket[] {
  const { granularity, rangeCount, rangePreset, rangeFrom, rangeTo } = settings;

  if (rangePreset === "thisMonth" || rangePreset === "lastMonth") {
    const { from, to } = monthRange(rangePreset === "thisMonth" ? 0 : 1, now);
    return analyzeBucketsBetween(granularity, from, to);
  }

  if (rangePreset === "custom" && rangeFrom && rangeTo) {
    const buckets = analyzeBucketsBetween(granularity, rangeFrom, rangeTo);
    if (buckets.length > 0) return buckets;
  }

  return analyzeBuckets(granularity, rangeCount, now);
}

/** Short description of the active window, for the header. */
export function describeRange(settings: AnalyzeRangeSettings, unit: string): string {
  if (settings.rangePreset === "thisMonth") return "今月";
  if (settings.rangePreset === "lastMonth") return "先月";
  if (settings.rangePreset === "custom" && settings.rangeFrom && settings.rangeTo) {
    return `${settings.rangeFrom} – ${settings.rangeTo}`;
  }
  return `直近 ${settings.rangeCount} ${unit}`;
}
