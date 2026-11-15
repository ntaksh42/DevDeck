import { writeStoredString } from "./storage";

// Body text typeface (Settings > Appearance). Each value maps to a
// `[data-font="..."]` rule in index.css that overrides --font-ui; "hyperlegible"
// has no override and uses the bundled Atkinson Hyperlegible + BIZ UDPGothic
// stack from :root. Monospace text (code, diffs, IDs) is not affected.
export type UiFont = "hyperlegible" | "biz-ud" | "yu-gothic" | "meiryo" | "system";

export const UI_FONTS: { value: UiFont; label: string; family: string }[] = [
  { value: "hyperlegible", label: "Hyperlegible", family: '"Atkinson Hyperlegible Next Variable", "BIZ UDPGothic"' },
  { value: "biz-ud", label: "BIZ UDPGothic", family: '"BIZ UDPGothic"' },
  { value: "yu-gothic", label: "Yu Gothic UI", family: '"Yu Gothic UI", "Yu Gothic"' },
  { value: "meiryo", label: "Meiryo UI", family: '"Meiryo UI", Meiryo' },
  { value: "system", label: "System", family: "system-ui" },
];

export const DEFAULT_UI_FONT: UiFont = "hyperlegible";

const STORAGE_KEY = "azdodeck:uiFont";

export function loadUiFont(): UiFont {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return UI_FONTS.some((f) => f.value === value) ? (value as UiFont) : DEFAULT_UI_FONT;
  } catch {
    return DEFAULT_UI_FONT;
  }
}

export function applyUiFont(font: UiFont): void {
  document.documentElement.setAttribute("data-font", font);
}

export function setUiFont(font: UiFont): void {
  writeStoredString(STORAGE_KEY, font);
  applyUiFont(font);
}
