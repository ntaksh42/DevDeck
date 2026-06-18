// The view the app opens on. Stored locally because it is a pure frontend
// preference that selects which React view renders at startup; it never needs
// to reach the backend.

export type DefaultView = "today" | "myReviews" | "myWorkItems";

export const DEFAULT_VIEW_OPTIONS: { value: DefaultView; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "myReviews", label: "My Reviews" },
  { value: "myWorkItems", label: "My Work Items" },
];

const DEFAULT_VIEW_STORAGE_KEY = "azdodeck:view:default:v1";
const FALLBACK_DEFAULT_VIEW: DefaultView = "today";

function isDefaultView(value: unknown): value is DefaultView {
  return value === "today" || value === "myReviews" || value === "myWorkItems";
}

export function loadDefaultView(): DefaultView {
  try {
    const stored = window.localStorage.getItem(DEFAULT_VIEW_STORAGE_KEY);
    return isDefaultView(stored) ? stored : FALLBACK_DEFAULT_VIEW;
  } catch {
    return FALLBACK_DEFAULT_VIEW;
  }
}

export function storeDefaultView(view: DefaultView): void {
  window.localStorage.setItem(DEFAULT_VIEW_STORAGE_KEY, view);
}
