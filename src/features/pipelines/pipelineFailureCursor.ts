// Tracks the last run result we have already notified about per watched
// pipeline, so a desktop notification fires once on a success→failed
// transition rather than on every poll. Stored locally because the watch list
// itself lives in localStorage (see pipelineSubscriptionsStorage).

const STORAGE_KEY = "azdodeck:pipelineFailureCursor";

type Cursor = { buildId: number; result: string | null };
type CursorMap = Record<string, Cursor>;

function load(): CursorMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as CursorMap) : {};
  } catch {
    return {};
  }
}

function save(map: CursorMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage full / unavailable: notifications degrade to none, never throw.
  }
}

export function readPipelineCursor(key: string): Cursor | undefined {
  return load()[key];
}

export function writePipelineCursor(key: string, cursor: Cursor): void {
  const map = load();
  map[key] = cursor;
  save(map);
}

/**
 * Decides whether the latest run is a newly-observed failure worth notifying:
 * the build id changed since we last recorded it (or it's the first time we see
 * this pipeline with a result), and the new result is "failed". The first-ever
 * observation only notifies if it is already failed, which is the desired "CI is
 * currently broken" signal.
 */
export function isNewFailure(
  previous: Cursor | undefined,
  latest: Cursor,
): boolean {
  if (latest.result !== "failed") return false;
  if (!previous) return true;
  return previous.buildId !== latest.buildId || previous.result !== "failed";
}
