import { writeStoredString } from "./storage";

// Color of the app frame (navigation sidebar + header). The values map to
// `[data-frame="..."]` rules in index.css; "teal" has no override rule and
// falls back to the --frame tokens in :root / .dark. Default is "white".
export type FrameColor = "teal" | "white" | "slate" | "navy" | "graphite";

export const FRAME_COLORS: { value: FrameColor; label: string; swatch: string }[] = [
  { value: "white", label: "White", swatch: "#ffffff" },
  { value: "teal", label: "Teal", swatch: "#12404a" },
  { value: "slate", label: "Slate", swatch: "#475569" },
  { value: "navy", label: "Navy", swatch: "#1e3a5f" },
  { value: "graphite", label: "Graphite", swatch: "#27272a" },
];

export const DEFAULT_FRAME_COLOR: FrameColor = "white";

const STORAGE_KEY = "azdodeck:frameColor";

export function loadFrameColor(): FrameColor {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return FRAME_COLORS.some((c) => c.value === value) ? (value as FrameColor) : DEFAULT_FRAME_COLOR;
  } catch {
    return DEFAULT_FRAME_COLOR;
  }
}

export function applyFrameColor(color: FrameColor): void {
  document.documentElement.setAttribute("data-frame", color);
}

export function setFrameColor(color: FrameColor): void {
  writeStoredString(STORAGE_KEY, color);
  applyFrameColor(color);
}
