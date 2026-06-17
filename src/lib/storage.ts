/**
 * Helpers for the recurring "read a JSON blob from localStorage, falling back on
 * missing/corrupt data" pattern used by the feature view/preset stores.
 *
 * Validation stays with each caller via `parse`, because the shape differs per
 * key. These helpers only own the parts that were genuinely duplicated: the
 * `JSON.parse` + try/catch, the `window` guard, and JSON serialization on write.
 */

/**
 * Reads and parses a JSON value from localStorage. Returns `fallback` when the
 * key is absent, the stored text is not valid JSON, storage is unavailable
 * (e.g. SSR or a privacy-locked browser), or `parse` rejects the parsed value
 * by returning `undefined`.
 */
export function readStoredJson<T>(
  key: string,
  parse: (raw: unknown) => T | undefined,
  fallback: T,
): T {
  if (typeof window === "undefined") return fallback;
  try {
    const text = window.localStorage.getItem(key);
    if (text === null) return fallback;
    const result = parse(JSON.parse(text));
    return result === undefined ? fallback : result;
  } catch {
    return fallback;
  }
}

/** Serializes `value` as JSON into localStorage, ignoring storage failures. */
export function writeStoredJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable or full; persistence is best-effort.
  }
}
