import { writeStoredString } from "./storage";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "azdodeck:theme";

// Emitted on the window when the preference changes so the app shell and the
// settings panel stay in sync without prop drilling. Mirrors the existing
// CustomEvent pattern in App.tsx (dispatchWorkItemCommand).
export const THEME_CHANGED_EVENT = "azdodeck:theme-changed";

export function loadThemePreference(): ThemePreference {
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function storeThemePreference(pref: ThemePreference): void {
  writeStoredString(STORAGE_KEY, pref);
}

function prefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function resolveTheme(pref: ThemePreference): "light" | "dark" {
  if (pref === "system") return prefersDark() ? "dark" : "light";
  return pref;
}

export function applyTheme(pref: ThemePreference): void {
  document.documentElement.classList.toggle("dark", resolveTheme(pref) === "dark");
}

// Subscribes to OS color-scheme changes; returns an unsubscribe function. The
// matchMedia guard keeps this usable in environments without it (e.g. jsdom).
export function watchSystemTheme(onChange: () => void): () => void {
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (!media) return () => {};
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

// Persists the preference, applies it immediately, and notifies other parts of
// the app listening for THEME_CHANGED_EVENT.
export function setThemePreference(pref: ThemePreference): void {
  storeThemePreference(pref);
  applyTheme(pref);
  window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: pref }));
}
