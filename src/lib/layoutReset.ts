/**
 * Layout width persistence lives in localStorage under the `azdodeck:layout:`
 * prefix (sidebar width, preview widths, grid column widths, column
 * visibility). These widths are easy to break by dragging and hard to restore,
 * so this helper resets them in one place.
 *
 * Only layout keys are removed: saved Work Item Views, command palette usage,
 * organizations, and credentials use different prefixes and are left untouched.
 */

export const LAYOUT_STORAGE_PREFIX = "azdodeck:layout:";

/** Returns the layout-width localStorage keys currently set. */
export function layoutStorageKeys(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return Object.keys(window.localStorage).filter((key) =>
      key.startsWith(LAYOUT_STORAGE_PREFIX),
    );
  } catch {
    return [];
  }
}

/**
 * Removes every persisted layout width. Returns the number of keys removed.
 * Components hold these widths in React state, so callers that need the live UI
 * to fall back to defaults should reload afterwards (see `resetLayoutWidths`).
 */
export function clearLayoutStorage(): number {
  const keys = layoutStorageKeys();
  for (const key of keys) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Storage can be unavailable; clearing is best-effort.
    }
  }
  return keys.length;
}

/**
 * Resets all layout widths to their defaults by clearing the persisted values
 * and reloading so every grid/preview/sidebar re-initializes from its default.
 */
export function resetLayoutWidths(): void {
  clearLayoutStorage();
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}
