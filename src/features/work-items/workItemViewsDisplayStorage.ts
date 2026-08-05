// Display-only preferences and count history for the work item views panel.
// Kept out of workItemViewsStorage.ts so that file stays focused on the view
// definitions themselves (which are exported, imported, and shared).

const WI_VIEWS_COLLAPSED_STORAGE_KEY = "azdodeck:workItemViewsCollapsed";
const WI_VIEWS_CARD_MODE_STORAGE_KEY = "azdodeck:workItemViewsCardMode";
export const WI_VIEW_COUNT_HISTORY_STORAGE_KEY = "azdodeck:workItems:viewCountHistory";

/** Number of points kept per view for the card sparkline. */
export const VIEW_COUNT_HISTORY_LIMIT = 20;
/** A sparkline needs at least two points to show a direction. */
export const VIEW_COUNT_HISTORY_MIN_POINTS = 2;

export type WorkItemViewsCardMode = "card" | "compact";

export function loadWorkItemViewsCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(WI_VIEWS_COLLAPSED_STORAGE_KEY) === "true";
}

export function saveWorkItemViewsCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WI_VIEWS_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
}

export function loadWorkItemViewsCardMode(): WorkItemViewsCardMode {
  if (typeof window === "undefined") return "card";
  return window.localStorage.getItem(WI_VIEWS_CARD_MODE_STORAGE_KEY) === "compact"
    ? "compact"
    : "card";
}

export function saveWorkItemViewsCardMode(mode: WorkItemViewsCardMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WI_VIEWS_CARD_MODE_STORAGE_KEY, mode);
}

function loadStoredHistories(): Record<string, number[]> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(WI_VIEW_COUNT_HISTORY_STORAGE_KEY) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const histories: Record<string, number[]> = {};
    for (const [id, points] of Object.entries(parsed)) {
      if (!Array.isArray(points)) continue;
      const numbers = points.filter(
        (point): point is number => typeof point === "number" && Number.isFinite(point),
      );
      if (numbers.length > 0) histories[id] = numbers.slice(-VIEW_COUNT_HISTORY_LIMIT);
    }
    return histories;
  } catch {
    return {};
  }
}

export function viewCountHistory(viewId: string): number[] {
  return loadStoredHistories()[viewId] ?? [];
}

/**
 * Appends a count to a view's history, dropping the oldest points past the
 * limit and pruning views that no longer exist. Repeating the same count is a
 * no-op so an idle session does not flatten the line with duplicates.
 */
export function recordViewCountHistory(
  viewId: string,
  count: number,
  knownViewIds: string[],
): void {
  if (typeof window === "undefined") return;
  const stored = loadStoredHistories();
  const known = new Set(knownViewIds);
  const next: Record<string, number[]> = {};
  for (const [id, points] of Object.entries(stored)) {
    if (known.has(id)) next[id] = points;
  }
  const points = next[viewId] ?? [];
  if (points[points.length - 1] === count) return;
  next[viewId] = [...points, count].slice(-VIEW_COUNT_HISTORY_LIMIT);
  window.localStorage.setItem(WI_VIEW_COUNT_HISTORY_STORAGE_KEY, JSON.stringify(next));
}

export type SparklineGeometry = {
  /** `points` attribute for the polyline. */
  line: string;
  /** `points` attribute for the filled area below the line. */
  area: string;
  /** Center of the marker on the latest point. */
  last: { x: number; y: number };
  trend: "up" | "down" | "flat";
};

/**
 * Maps a count history onto an SVG viewBox. A flat series is drawn along the
 * vertical middle rather than pinned to an edge, which is what a min===max
 * normalization would otherwise produce.
 */
export function sparklineGeometry(
  points: number[],
  width: number,
  height: number,
): SparklineGeometry | null {
  if (points.length < VIEW_COUNT_HISTORY_MIN_POINTS) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const stepX = width / (points.length - 1);
  const coordinates = points.map((point, index) => {
    const x = Math.round(index * stepX * 100) / 100;
    const ratio = span === 0 ? 0.5 : (point - min) / span;
    const y = Math.round((height - ratio * height) * 100) / 100;
    return { x, y };
  });

  const first = points[0];
  const last = points[points.length - 1];
  return {
    line: coordinates.map(({ x, y }) => `${x},${y}`).join(" "),
    area: [
      ...coordinates.map(({ x, y }) => `${x},${y}`),
      `${width},${height}`,
      `0,${height}`,
    ].join(" "),
    last: coordinates[coordinates.length - 1],
    trend: last > first ? "up" : last < first ? "down" : "flat",
  };
}
