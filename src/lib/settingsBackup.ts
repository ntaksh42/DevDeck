import { readStoredString, writeStoredString } from "./storage";

/**
 * Personal settings kept in localStorage that can be moved to another PC.
 *
 * This is an allowlist: a key that is not listed here is never exported, so
 * credentials, connections, local paths and caches stay out of the file. Notification
 * rules and Quiet hours live in SQLite (`app_settings`) and are not covered yet.
 */
export type BackupShape = "object" | "array" | "string";

export type BackupGroup = {
  id: string;
  label: string;
  /** Storage keys and the JSON shape their value must have. */
  keys: { key: string; shape: BackupShape }[];
};

export const BACKUP_GROUPS: readonly BackupGroup[] = [
  { id: "keybindings", label: "Keyboard shortcuts", keys: [{ key: "azdodeck:keybindings:v1", shape: "object" }] },
  { id: "rowColors", label: "Row color rules", keys: [{ key: "azdodeck:rowColorRules:v1", shape: "array" }] },
  { id: "quickPipelines", label: "Quick pipelines", keys: [{ key: "azdodeck:quickPipelines", shape: "array" }] },
  {
    id: "workItemViews",
    label: "Work item views, templates and field presets",
    keys: [
      { key: "azdodeck:workItemQueryViews", shape: "array" },
      { key: "azdodeck:workItemTemplates", shape: "array" },
      { key: "azdodeck:workItems:fieldPresets", shape: "array" },
    ],
  },
  {
    id: "display",
    label: "Theme and navigation order",
    keys: [
      { key: "azdodeck:theme", shape: "string" },
      { key: "azdodeck:layout:navOrder", shape: "array" },
    ],
  },
];

export const BACKUP_VERSION = 1;
export type ImportMode = "overwrite" | "merge" | "skip";

export type SettingsBackup = {
  app: "devdeck";
  version: number;
  exportedAt: string;
  /** group id -> storage key -> raw stored value */
  groups: Record<string, Record<string, string>>;
};

function shapeOf(value: unknown): BackupShape | null {
  if (Array.isArray(value)) return "array";
  if (value !== null && typeof value === "object") return "object";
  return typeof value === "string" ? "string" : null;
}

/** A stored value is valid for `shape` when it is JSON of that shape (theme is a bare string). */
function isValidValue(raw: string, shape: BackupShape): boolean {
  if (shape === "string") return raw.length > 0 && raw.length < 64;
  try {
    return shapeOf(JSON.parse(raw)) === shape;
  } catch {
    return false;
  }
}

export function buildBackup(groupIds: readonly string[], now = new Date()): SettingsBackup {
  const groups: SettingsBackup["groups"] = {};
  for (const group of BACKUP_GROUPS) {
    if (!groupIds.includes(group.id)) continue;
    const entries: Record<string, string> = {};
    for (const { key, shape } of group.keys) {
      const raw = readStoredString(key);
      if (raw !== null && isValidValue(raw, shape)) entries[key] = raw;
    }
    if (Object.keys(entries).length > 0) groups[group.id] = entries;
  }
  return { app: "devdeck", version: BACKUP_VERSION, exportedAt: now.toISOString(), groups };
}

/** Parses and validates a backup file; throws an Error whose message says why it was rejected. */
export function parseBackup(text: string): SettingsBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  const file = data as Partial<SettingsBackup> | null;
  if (!file || file.app !== "devdeck" || typeof file.groups !== "object" || file.groups === null) {
    throw new Error("This is not a DevDeck settings backup.");
  }
  if (typeof file.version !== "number" || file.version > BACKUP_VERSION) {
    throw new Error("This backup was made by a newer DevDeck. Update the app and try again.");
  }
  const groups: SettingsBackup["groups"] = {};
  for (const group of BACKUP_GROUPS) {
    const entries = file.groups[group.id];
    if (entries === undefined) continue;
    const valid: Record<string, string> = {};
    for (const { key, shape } of group.keys) {
      const raw = (entries as Record<string, unknown>)?.[key];
      if (raw === undefined) continue;
      if (typeof raw !== "string" || !isValidValue(raw, shape)) {
        throw new Error(`"${group.label}" has an invalid value for ${key}.`);
      }
      valid[key] = raw;
    }
    if (Object.keys(valid).length > 0) groups[group.id] = valid;
  }
  return { app: "devdeck", version: file.version, exportedAt: String(file.exportedAt ?? ""), groups };
}

/** Item count shown in the import preview (array length, object keys, or 1). */
export function countEntries(raw: string): number {
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value)) return value.length;
    if (value !== null && typeof value === "object") return Object.keys(value).length;
  } catch {
    // A bare string (theme) is one setting.
  }
  return 1;
}

function mergeRaw(current: string | null, incoming: string): string {
  if (current === null) return incoming;
  try {
    const a: unknown = JSON.parse(current);
    const b: unknown = JSON.parse(incoming);
    if (Array.isArray(a) && Array.isArray(b)) {
      const idOf = (item: unknown) =>
        item !== null && typeof item === "object" ? (item as { id?: unknown }).id : undefined;
      const known = new Set<unknown>(a.map(idOf).filter((id) => id !== undefined));
      // Items without an id cannot be matched, so they are appended as they are.
      return JSON.stringify([...a, ...b.filter((item) => !known.has(idOf(item)))]);
    }
    if (shapeOf(a) === "object" && shapeOf(b) === "object") {
      return JSON.stringify({ ...(a as object), ...(b as object) });
    }
  } catch {
    // Fall through: an unreadable current value is replaced.
  }
  return incoming;
}

/** Writes the chosen groups; returns how many storage keys were written. */
export function applyBackup(backup: SettingsBackup, modes: Record<string, ImportMode>): number {
  let written = 0;
  for (const [groupId, entries] of Object.entries(backup.groups)) {
    const mode = modes[groupId] ?? "skip";
    if (mode === "skip") continue;
    for (const [key, raw] of Object.entries(entries)) {
      writeStoredString(key, mode === "merge" ? mergeRaw(readStoredString(key), raw) : raw);
      written += 1;
    }
  }
  return written;
}
