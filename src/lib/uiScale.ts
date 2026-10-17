import { readStoredString, writeStoredString } from "./storage";

export const UI_SCALE_LEVELS = [90, 100, 110, 125, 150] as const;
export type UiScale = (typeof UI_SCALE_LEVELS)[number];

const DEFAULT_SCALE: UiScale = 100;
const STORAGE_KEY = "azdodeck:uiScale";

// Emitted on the window when the scale changes so the settings panel stays in
// sync with shortcut-driven changes (same pattern as THEME_CHANGED_EVENT).
export const UI_SCALE_CHANGED_EVENT = "azdodeck:ui-scale-changed";

export function loadUiScale(): UiScale {
  const value = Number(readStoredString(STORAGE_KEY));
  return UI_SCALE_LEVELS.find((level) => level === value) ?? DEFAULT_SCALE;
}

export function applyUiScale(scale: UiScale): void {
  document.documentElement.style.zoom = scale === DEFAULT_SCALE ? "" : `${scale}%`;
}

export function setUiScale(scale: UiScale): void {
  writeStoredString(STORAGE_KEY, String(scale));
  applyUiScale(scale);
  window.dispatchEvent(new CustomEvent(UI_SCALE_CHANGED_EVENT, { detail: scale }));
}

export function stepUiScale(direction: 1 | -1): void {
  const index = UI_SCALE_LEVELS.indexOf(loadUiScale()) + direction;
  const next = UI_SCALE_LEVELS[Math.min(UI_SCALE_LEVELS.length - 1, Math.max(0, index))];
  setUiScale(next);
}

export function resetUiScale(): void {
  setUiScale(DEFAULT_SCALE);
}
