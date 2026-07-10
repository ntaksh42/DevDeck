import type { KeyboardEvent } from "react";

export type SortDirection = "asc" | "desc";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function storedNumber(key: string, fallback: number, min: number, max: number): number {
  const value = window.localStorage.getItem(key);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
}

export function storedNumbers(
  key: string,
  fallback: number[],
  mins: number[],
  maxs: number[],
): number[] {
  const value = window.localStorage.getItem(key);
  if (!value) return [...fallback];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== fallback.length) return [...fallback];
    return fallback.map((defaultValue, index) => {
      const parsedValue = Number(parsed[index]);
      if (!Number.isFinite(parsedValue)) return defaultValue;
      return clamp(parsedValue, mins[index], maxs[index]);
    });
  } catch {
    return [...fallback];
  }
}

export function gridColumnTemplate(
  widths: number[],
  flexibleIndex: number,
  prefixColumns: string[] = [],
): string {
  const columns = widths.map((width, index) =>
    index === flexibleIndex ? `minmax(${width}px, 1fr)` : `${width}px`,
  );
  return [...prefixColumns, ...columns].join(" ");
}

/**
 * Total intrinsic width (px) of a grid's columns including fixed prefix/suffix
 * tracks and the gaps between them. Applied as the row wrapper's `min-width`
 * so the table can grow past the viewport (with horizontal scroll) instead of
 * being locked to the container — which is what makes the flexible column
 * actually resizable.
 */
export function gridColumnsMinWidth(
  widths: number[],
  prefixColumns: string[] = [],
  suffixColumns: string[] = [],
  gap = 8,
): number {
  const fixed = [...prefixColumns, ...suffixColumns].reduce(
    (sum, track) => sum + (parseFloat(track) || 0),
    0,
  );
  const flexible = widths.reduce((sum, width) => sum + width, 0);
  const trackCount = prefixColumns.length + widths.length + suffixColumns.length;
  return fixed + flexible + Math.max(0, trackCount - 1) * gap;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  return !!element?.closest("input, textarea, select, [contenteditable='true']");
}

/**
 * Escape moves focus out of a search/filter input. Pass `onClear` for live
 * filters so Escape also resets the filter text; omit it for submitted search
 * queries where the typed text should survive the focus-out. Grid screens rely
 * on `useGridFocusRestoration` to send focus back to the selected row after the
 * blur; plain search forms simply release focus to the document body.
 */
export function handleSearchInputEscape(
  event: KeyboardEvent<HTMLInputElement>,
  onClear?: () => void,
): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  onClear?.();
  event.currentTarget.blur();
}

export function focusWorkItemCommentInput(): boolean {
  const textarea = document.querySelector<HTMLTextAreaElement>(
    "[data-work-item-comment-input='true']",
  );
  if (!textarea) return false;
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  return true;
}

export function focusPrimaryGrid(): boolean {
  const grid = document.querySelector<HTMLElement>("[data-primary-grid='true']");
  if (!grid) return false;
  const selectedRow = grid.querySelector<HTMLElement>("[role='row'][aria-selected='true']");
  const focusTarget =
    selectedRow ?? grid.querySelector<HTMLElement>("[tabindex='0']") ?? grid;
  focusTarget.focus();
  return true;
}

export function focusPrimaryPreview(): boolean {
  const preview = document.querySelector<HTMLElement>("[data-primary-preview='true']");
  if (!preview) return false;
  preview.focus();
  return true;
}

// Focuses the active view's main filter/search input (shared by Ctrl+F and the
// per-grid "/" shortcut so they target the same field everywhere).
export function focusFilterInput(): boolean {
  const input = document.querySelector<HTMLInputElement>(
    [
      "[data-filter-input='true']",
      "input[aria-label='Filter']",
      "input[type='search']",
      "input[placeholder*='Filter']",
      "input[placeholder*='Search']",
    ].join(","),
  );
  if (!input || input.disabled || input.hidden) return false;
  input.focus();
  input.select();
  return true;
}

export function focusViewsPanel(): boolean {
  const panel = document.querySelector<HTMLElement>("[data-views-panel='true']");
  if (!panel) return false;
  const firstButton = panel.querySelector<HTMLElement>("button[role='option']");
  if (firstButton) {
    firstButton.focus();
    return true;
  }
  panel.focus();
  return true;
}

export function splitSearchTerms(value: string): string[] {
  return value.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesAllSearchTerms(
  terms: string[],
  values: Array<string | number | null | undefined>,
): boolean {
  if (terms.length === 0) return true;
  const haystack = values
    .filter((value) => value !== null && value !== undefined)
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

// Builds a "[text](url)" Markdown link for the "copy as Markdown link" actions
// (PRs, work items, commits). Strips `[`/`]` from the text so it can't break
// out of the link syntax.
export function markdownLink(text: string, url: string): string {
  return `[${text.replace(/[[\]]/g, "")}](${url})`;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatRelativeDate(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
