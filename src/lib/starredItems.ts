/**
 * Local "starred" (bookmarked) Work Items and PRs.
 *
 * Stars live entirely in localStorage, keyed by organization id + item type +
 * item id, so they survive sync and never touch Azure DevOps. A starred item is
 * tracked even after it is closed or deleted from the server (an orphan); the UI
 * keeps the last-known title/url snapshot so it stays reachable.
 */
import { useSyncExternalStore } from "react";
import { readStoredJson, writeStoredJson } from "@/lib/storage";

export const STARRED_ITEMS_STORAGE_KEY = "azdodeck:starredItems:v1";

export type StarredItemType = "work_item" | "pull_request";

export type StarredItem = {
  organizationId: string;
  itemType: StarredItemType;
  itemId: string;
  title: string;
  /** Browser URL for the item, when known. Null for orphans without one. */
  webUrl: string | null;
  /** Optional secondary line (repo, project, state, …). */
  subtitle?: string;
  createdAt: string;
};

/** Stable identity used to look up / toggle a star. */
export function starKey(
  organizationId: string,
  itemType: StarredItemType,
  itemId: string,
): string {
  return `${organizationId}:${itemType}:${itemId}`;
}

function itemStarKey(item: Pick<StarredItem, "organizationId" | "itemType" | "itemId">): string {
  return starKey(item.organizationId, item.itemType, item.itemId);
}

function isStarredItem(value: unknown): value is StarredItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<StarredItem>;
  return (
    typeof item.organizationId === "string" &&
    item.organizationId.length > 0 &&
    (item.itemType === "work_item" || item.itemType === "pull_request") &&
    typeof item.itemId === "string" &&
    item.itemId.length > 0 &&
    typeof item.title === "string" &&
    (item.webUrl === null || typeof item.webUrl === "string") &&
    typeof item.createdAt === "string"
  );
}

export function loadStarredItems(): StarredItem[] {
  return readStoredJson(
    STARRED_ITEMS_STORAGE_KEY,
    (raw) => (Array.isArray(raw) ? raw.filter(isStarredItem) : undefined),
    [],
  );
}

function writeStarredItems(items: StarredItem[]): void {
  writeStoredJson(STARRED_ITEMS_STORAGE_KEY, items);
  notify();
}

/** True when the given item currently has a star. */
export function isStarred(
  organizationId: string,
  itemType: StarredItemType,
  itemId: string,
): boolean {
  const target = starKey(organizationId, itemType, itemId);
  return loadStarredItems().some((item) => itemStarKey(item) === target);
}

/**
 * Toggles the star for an item. When turning it on, the latest title/url
 * snapshot is stored so the item stays reachable even after it leaves the grid.
 * Returns the new starred state.
 */
export function toggleStar(item: Omit<StarredItem, "createdAt">): boolean {
  const target = itemStarKey(item);
  const current = loadStarredItems();
  const existing = current.find((entry) => itemStarKey(entry) === target);
  if (existing) {
    writeStarredItems(current.filter((entry) => itemStarKey(entry) !== target));
    return false;
  }
  writeStarredItems([
    { ...item, createdAt: new Date().toISOString() },
    ...current,
  ]);
  return true;
}

/** Removes a star regardless of current state (e.g. an "Unstar" button). */
export function removeStar(
  organizationId: string,
  itemType: StarredItemType,
  itemId: string,
): void {
  const target = starKey(organizationId, itemType, itemId);
  writeStarredItems(loadStarredItems().filter((item) => itemStarKey(item) !== target));
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Stars can also change in another tab/window.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STARRED_ITEMS_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

let cache: StarredItem[] = loadStarredItems();
let cacheRaw: string | null = null;

// useSyncExternalStore requires a stable snapshot reference between renders when
// nothing changed; recompute only when the underlying JSON string differs.
function getSnapshot(): StarredItem[] {
  const raw =
    typeof window === "undefined"
      ? null
      : window.localStorage.getItem(STARRED_ITEMS_STORAGE_KEY);
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cache = loadStarredItems();
  }
  return cache;
}

/** Subscribe a component to the full starred list. */
export function useStarredItems(): StarredItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
