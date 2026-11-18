/**
 * Layout persistence lives in localStorage under the `azdodeck:layout:`
 * prefix (sidebar width, preview widths, grid column widths, column
 * visibility, and the dockview panel arrangements -- which views/panes are
 * docked where, and their sizes). These are easy to break by dragging and
 * hard to restore, so this helper resets them all in one place.
 *
 * Only layout keys are removed: saved Work Item Views, command palette usage,
 * organizations, and credentials use different prefixes and are left untouched.
 */

export const LAYOUT_STORAGE_PREFIX = "azdodeck:layout:";

/**
 * Every prefix that holds layout. Agent Work's dock arrangements predate the
 * `azdodeck:layout:` naming; renaming them would drop users' saved layouts.
 */
export const LAYOUT_STORAGE_PREFIXES = [
  LAYOUT_STORAGE_PREFIX,
  "azdodeck:agentWork:dockview:",
  "azdodeck:agentWorkCandidates:dockview:",
];

export function isLayoutStorageKey(key: string): boolean {
  return LAYOUT_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Returns the layout-width localStorage keys currently set. */
export function layoutStorageKeys(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return Object.keys(window.localStorage).filter(isLayoutStorageKey);
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
