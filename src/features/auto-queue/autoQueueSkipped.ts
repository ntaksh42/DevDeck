import { autoQueueKey, type AutoQueueTarget } from "@/lib/azdoCommands";
import { readStoredJson, writeStoredJson } from "@/lib/storage";

// Items skipped in Auto queue stay out of the list. Kept in this browser only:
// a skip is a view preference, nothing the backend needs to know.
const STORAGE_KEY = "azdodeck:autoQueue:skipped";
const REMEMBERED = 500;

export function loadSkipped(): string[] {
  return readStoredJson<string[]>(
    STORAGE_KEY,
    (raw) => (Array.isArray(raw) ? raw.filter((key): key is string => typeof key === "string") : undefined),
    [],
  );
}

export function addSkipped(current: string[], targets: AutoQueueTarget[]): string[] {
  const next = [...new Set([...current, ...targets.map(autoQueueKey)])].slice(-REMEMBERED);
  writeStoredJson(STORAGE_KEY, next);
  return next;
}

export function clearSkipped(): string[] {
  writeStoredJson(STORAGE_KEY, []);
  return [];
}
