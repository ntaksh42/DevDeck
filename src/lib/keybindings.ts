// Central registry for the app-level keyboard shortcuts that App.tsx owns.
//
// Phase 1 (issue #166) makes the *global* bindings rebindable: the command
// palette, focus moves, sync/refresh, settings, help, and the "go to view"
// chain. Grid-local single-letter shortcuts (vote keys, row movement, work item
// actions) still live in their own components and are out of scope here.
//
// A binding is matched against a KeyboardEvent by its combo string, e.g.
// "Ctrl+K", "Alt+G", "S", or for the chain leader "G". Overrides are stored in
// localStorage and fall back to the declared default when unset.

export type KeybindingScope = "global" | "goto";

export type KeybindingId =
  | "commandPalette"
  | "focusFilter"
  | "refreshCurrentView"
  | "applyStaged"
  | "help"
  | "focusNavigation"
  | "focusGrid"
  | "focusPreview"
  | "focusViewsPanel"
  | "focusComment"
  | "toggleSidebar"
  | "syncNow"
  | "openSettings"
  | "gotoLeader"
  | "gotoMyReviews"
  | "gotoPullRequestSearch"
  | "gotoMyWorkItems"
  | "gotoWorkItemSearch"
  | "gotoWorkItemViews"
  | "gotoCommits"
  | "gotoPipelines"
  | "gotoCodeSearch"
  | "gotoSettings";

export type Keybinding = {
  id: KeybindingId;
  /** Human-readable label shown in Settings and the help dialog. */
  label: string;
  /** Group heading for the Settings list. */
  group: string;
  /** Default combo string, e.g. "Ctrl+K". */
  defaultCombo: string;
  /**
   * "global" bindings carry their own modifiers and are matched directly.
   * "goto" bindings are the second key of the `G` chain; they are plain single
   * keys matched only after the leader is armed.
   */
  scope: KeybindingScope;
  /**
   * Reserved bindings cannot be rebound (e.g. the chain leader). They still
   * appear in the list so users understand the chain, but the input is locked.
   */
  reserved?: boolean;
};

// Declaration order drives the Settings list and help dialog order.
export const KEYBINDINGS: readonly Keybinding[] = [
  { id: "commandPalette", label: "Command palette", group: "General", defaultCombo: "Ctrl+K", scope: "global" },
  { id: "help", label: "Show keyboard shortcuts", group: "General", defaultCombo: "?", scope: "global" },
  { id: "syncNow", label: "Sync now", group: "General", defaultCombo: "Ctrl+E", scope: "global" },
  { id: "refreshCurrentView", label: "Refresh current view", group: "General", defaultCombo: "Ctrl+R", scope: "global" },
  { id: "applyStaged", label: "Apply pending work item changes", group: "General", defaultCombo: "Ctrl+S", scope: "global" },

  { id: "openSettings", label: "Go to Settings", group: "Focus & navigation", defaultCombo: "Ctrl+,", scope: "global" },
  { id: "focusNavigation", label: "Focus left navigation", group: "Focus & navigation", defaultCombo: "Ctrl+N", scope: "global" },
  { id: "focusGrid", label: "Focus grid", group: "Focus & navigation", defaultCombo: "Ctrl+G", scope: "global" },
  { id: "focusPreview", label: "Focus preview", group: "Focus & navigation", defaultCombo: "Ctrl+P", scope: "global" },
  { id: "focusViewsPanel", label: "Focus views panel", group: "Focus & navigation", defaultCombo: "Ctrl+B", scope: "global" },
  { id: "focusComment", label: "Focus work item comment", group: "Focus & navigation", defaultCombo: "Ctrl+M", scope: "global" },
  { id: "focusFilter", label: "Focus filter", group: "Focus & navigation", defaultCombo: "Ctrl+F", scope: "global" },
  { id: "toggleSidebar", label: "Collapse / expand left navigation", group: "Focus & navigation", defaultCombo: "Ctrl+\\", scope: "global" },

  { id: "gotoLeader", label: "Go to view (leader key, then a letter below)", group: "Go to view", defaultCombo: "G", scope: "global", reserved: true },
  { id: "gotoMyReviews", label: "My Reviews", group: "Go to view", defaultCombo: "R", scope: "goto" },
  { id: "gotoPullRequestSearch", label: "Pull Request Search", group: "Go to view", defaultCombo: "Q", scope: "goto" },
  { id: "gotoMyWorkItems", label: "My Work Items", group: "Go to view", defaultCombo: "W", scope: "goto" },
  { id: "gotoWorkItemSearch", label: "Work Item Search", group: "Go to view", defaultCombo: "I", scope: "goto" },
  { id: "gotoWorkItemViews", label: "Work Item Views", group: "Go to view", defaultCombo: "V", scope: "goto" },
  { id: "gotoCommits", label: "Commits", group: "Go to view", defaultCombo: "C", scope: "goto" },
  { id: "gotoPipelines", label: "Pipelines", group: "Go to view", defaultCombo: "P", scope: "goto" },
  { id: "gotoCodeSearch", label: "Code", group: "Go to view", defaultCombo: "D", scope: "goto" },
  { id: "gotoSettings", label: "Settings", group: "Go to view", defaultCombo: "S", scope: "goto" },
] as const;

const KEYBINDING_BY_ID = new Map<KeybindingId, Keybinding>(
  KEYBINDINGS.map((binding) => [binding.id, binding]),
);

export type KeybindingMap = Record<KeybindingId, string>;

// Bump the suffix if the stored shape changes incompatibly.
export const KEYBINDINGS_STORAGE_KEY = "azdodeck:keybindings:v1";

// Emitted on the window when overrides change so App.tsx re-reads the effective
// map without prop drilling (mirrors THEME_CHANGED_EVENT).
export const KEYBINDINGS_CHANGED_EVENT = "azdodeck:keybindings-changed";

export function defaultKeybindingMap(): KeybindingMap {
  const map = {} as KeybindingMap;
  for (const binding of KEYBINDINGS) {
    map[binding.id] = binding.defaultCombo;
  }
  return map;
}

export function loadKeybindingOverrides(): Partial<KeybindingMap> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEYBINDINGS_STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    const overrides: Partial<KeybindingMap> = {};
    for (const binding of KEYBINDINGS) {
      if (binding.reserved) continue;
      const value = (parsed as Record<string, unknown>)[binding.id];
      if (typeof value === "string" && value.length > 0) {
        overrides[binding.id] = value;
      }
    }
    return overrides;
  } catch {
    return {};
  }
}

export function saveKeybindingOverrides(overrides: Partial<KeybindingMap>): void {
  // Persist only entries that differ from the default so resetting one binding
  // simply drops it back to the declared value.
  const trimmed: Partial<KeybindingMap> = {};
  for (const binding of KEYBINDINGS) {
    if (binding.reserved) continue;
    const value = overrides[binding.id];
    if (typeof value === "string" && value.length > 0 && value !== binding.defaultCombo) {
      trimmed[binding.id] = value;
    }
  }
  if (Object.keys(trimmed).length === 0) {
    window.localStorage.removeItem(KEYBINDINGS_STORAGE_KEY);
  } else {
    window.localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(trimmed));
  }
  window.dispatchEvent(new CustomEvent(KEYBINDINGS_CHANGED_EVENT));
}

export function resolveKeybindings(): KeybindingMap {
  const map = defaultKeybindingMap();
  const overrides = loadKeybindingOverrides();
  for (const binding of KEYBINDINGS) {
    if (binding.reserved) continue;
    const value = overrides[binding.id];
    if (value) map[binding.id] = value;
  }
  return map;
}

// --- combo parsing & matching ------------------------------------------------

type ParsedCombo = {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string; // normalized, upper-cased single chars
};

export function normalizeKey(key: string): string {
  if (!key) return "";
  if (key === " " || key === "Spacebar") return "Space";
  if (key === "Esc") return "Escape";
  return key.length === 1 ? key.toUpperCase() : key;
}

function isModifierKey(key: string): boolean {
  return key === "Control" || key === "Alt" || key === "Shift" || key === "Meta";
}

export function parseCombo(combo: string): ParsedCombo | null {
  const parts = combo.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const parsed: ParsedCombo = { ctrl: false, alt: false, shift: false, meta: false, key: "" };
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control") parsed.ctrl = true;
    else if (lower === "alt") parsed.alt = true;
    else if (lower === "shift") parsed.shift = true;
    else if (lower === "meta" || lower === "cmd" || lower === "win") parsed.meta = true;
    else parsed.key = normalizeKey(part);
  }
  return parsed.key ? parsed : null;
}

// Builds a combo string from a keyboard event for the capture input in Settings.
// Returns null while only modifiers are held.
export function comboFromEvent(event: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): string | null {
  const key = normalizeKey(event.key);
  if (!key || isModifierKey(event.key)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  // For printable keys, Shift is usually implied by the produced character
  // (e.g. "?"), so do not also require a literal Shift modifier.
  if (key.length === 1 && parts.length === 1 && parts[0] === "Shift") parts.pop();
  parts.push(key);
  return parts.join("+");
}

// Matches a global binding combo against a keyboard event. Treats Ctrl and Meta
// interchangeably so the existing Ctrl/Cmd handling is preserved.
export function matchesCombo(
  combo: string,
  event: {
    key: string;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
  },
): boolean {
  const parsed = parseCombo(combo);
  if (!parsed) return false;
  const eventKey = normalizeKey(event.key);
  if (eventKey !== parsed.key) return false;
  if (parsed.alt !== event.altKey) return false;
  if (parsed.ctrl || parsed.meta) {
    if (!(event.ctrlKey || event.metaKey)) return false;
  } else if (event.ctrlKey || event.metaKey) {
    return false;
  }
  // Shift is only enforced for non-printable keys; printable combos like "?"
  // already encode the shifted character in `key`.
  if (parsed.key.length > 1 && parsed.shift !== event.shiftKey) return false;
  return true;
}

// Detects bindings that share the same combo within the same scope. Returns a
// map of binding id -> list of conflicting ids (excluding itself). Reserved
// bindings are ignored.
export function findConflicts(map: KeybindingMap): Map<KeybindingId, KeybindingId[]> {
  const byCombo = new Map<string, KeybindingId[]>();
  for (const binding of KEYBINDINGS) {
    if (binding.reserved) continue;
    const combo = (map[binding.id] ?? "").trim();
    if (!combo) continue;
    const key = `${binding.scope}::${combo.toLowerCase()}`;
    const list = byCombo.get(key) ?? [];
    list.push(binding.id);
    byCombo.set(key, list);
  }
  const conflicts = new Map<KeybindingId, KeybindingId[]>();
  for (const ids of byCombo.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      conflicts.set(
        id,
        ids.filter((other) => other !== id),
      );
    }
  }
  return conflicts;
}

export function keybindingLabel(id: KeybindingId): string {
  return KEYBINDING_BY_ID.get(id)?.label ?? id;
}
