// Export / import of the user's local UI configuration (layouts, saved views,
// key bindings, color rules, ...) as one JSON document so a setup can be moved
// to another machine. Only an allow-list of key prefixes travels, and anything
// that looks like a credential is refused even if it matches the allow-list.
// Organizations and PAT/Azure CLI secrets are never part of the export.

export const SETTINGS_EXPORT_VERSION = 1;

const ALLOWED_PREFIXES = [
  "azdodeck:layout:",
  "azdodeck:view:",
  "azdodeck:keybindings:",
  "azdodeck:rowColorRules:",
  "azdodeck:workItemViews",
  "azdodeck:workItemQueryViews",
  "azdodeck:workItemViewLayout:",
  "azdodeck:workItemTemplates",
  "azdodeck:workItems:fieldPresets",
  "azdodeck:workItems:previewCustomFields",
  "azdodeck:wiPreview:",
  "azdodeck:analyze:groups",
  "azdodeck:quickPipelines",
  "azdodeck:pipelineSubscriptions",
  "azdodeck:theme",
  "azdodeck:uiScale",
];

const SECRET_PATTERN = /pat|token|secret|password|credential|azure-cli/i;

export type SettingsExport = {
  app: "devdeck";
  version: typeof SETTINGS_EXPORT_VERSION;
  exportedAt: string;
  entries: Record<string, string>;
};

/** True when `key` may be exported / imported. */
export function isTransferableKey(key: string): boolean {
  if (!ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) return false;
  // Match the part after the app prefix so "azdodeck" itself never trips it.
  return !SECRET_PATTERN.test(key.slice("azdodeck:".length));
}

export function buildSettingsExport(
  storage: Pick<Storage, "length" | "key" | "getItem">,
  now: Date = new Date(),
): SettingsExport {
  const entries: Record<string, string> = {};
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key || !isTransferableKey(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) entries[key] = value;
  }
  return { app: "devdeck", version: SETTINGS_EXPORT_VERSION, exportedAt: now.toISOString(), entries };
}

export type ParsedSettingsImport =
  | { ok: true; entries: Record<string, string>; skipped: number }
  | { ok: false; error: string };

/** Validates import text. Unknown or unsafe keys are skipped, not applied. */
export function parseSettingsImport(text: string): ParsedSettingsImport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "The file is not valid JSON." };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "The file is not a DevDeck settings export." };
  }
  const doc = raw as Record<string, unknown>;
  if (doc.app !== "devdeck") {
    return { ok: false, error: "The file is not a DevDeck settings export." };
  }
  if (doc.version !== SETTINGS_EXPORT_VERSION) {
    return { ok: false, error: `Unsupported export version: ${String(doc.version)}.` };
  }
  if (!doc.entries || typeof doc.entries !== "object" || Array.isArray(doc.entries)) {
    return { ok: false, error: "The file has no settings entries." };
  }
  const entries: Record<string, string> = {};
  let skipped = 0;
  for (const [key, value] of Object.entries(doc.entries as Record<string, unknown>)) {
    if (typeof value === "string" && isTransferableKey(key)) entries[key] = value;
    else skipped += 1;
  }
  return { ok: true, entries, skipped };
}

/** Writes imported entries; returns how many were stored. */
export function applySettingsImport(
  entries: Record<string, string>,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): number {
  let stored = 0;
  for (const [key, value] of Object.entries(entries)) {
    if (!isTransferableKey(key)) continue;
    try {
      storage.setItem(key, value);
      stored += 1;
    } catch {
      // Quota or privacy-locked storage: keep going with the remaining keys.
    }
  }
  return stored;
}
