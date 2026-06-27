import { readStoredJson, writeStoredJson } from "@/lib/storage";

// The reorderable top-level nav entries, in their default order. Help/Settings
// stay pinned at the bottom and are not part of this list.
export type NavEntryId = "pullRequests" | "workItems" | "commits" | "pipelines" | "codeSearch";

export const DEFAULT_NAV_ORDER: NavEntryId[] = [
  "pullRequests",
  "workItems",
  "commits",
  "pipelines",
  "codeSearch",
];

const NAV_ORDER_STORAGE_KEY = "azdodeck:layout:navOrder";

/**
 * Coerces arbitrary stored data into a valid, complete nav order: keeps the
 * stored sequence of known ids (dropping unknowns and duplicates), then appends
 * any known ids missing from the stored data so the result is always a full
 * permutation of DEFAULT_NAV_ORDER. Returns undefined for non-array input so
 * callers fall back to the default.
 */
export function normalizeNavOrder(raw: unknown): NavEntryId[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const known = new Set<string>(DEFAULT_NAV_ORDER);
  const seen = new Set<NavEntryId>();
  const order: NavEntryId[] = [];
  for (const item of raw) {
    if (typeof item === "string" && known.has(item) && !seen.has(item as NavEntryId)) {
      order.push(item as NavEntryId);
      seen.add(item as NavEntryId);
    }
  }
  for (const id of DEFAULT_NAV_ORDER) {
    if (!seen.has(id)) order.push(id);
  }
  return order;
}

/**
 * Returns a new order with `fromId` moved to the position currently held by
 * `toId`. Never mutates the input. Returns the original array unchanged when the
 * move is a no-op or either id is missing.
 */
export function reorderNav(
  order: NavEntryId[],
  fromId: NavEntryId,
  toId: NavEntryId,
): NavEntryId[] {
  if (fromId === toId) return order;
  const from = order.indexOf(fromId);
  const to = order.indexOf(toId);
  if (from === -1 || to === -1) return order;
  const next = order.slice();
  next.splice(from, 1);
  next.splice(to, 0, fromId);
  return next;
}

/** Reads the saved nav order from localStorage, falling back to the default. */
export function loadNavOrder(): NavEntryId[] {
  return readStoredJson(NAV_ORDER_STORAGE_KEY, normalizeNavOrder, DEFAULT_NAV_ORDER);
}

/** Persists the nav order to localStorage (best-effort). */
export function saveNavOrder(order: NavEntryId[]): void {
  writeStoredJson(NAV_ORDER_STORAGE_KEY, order);
}
