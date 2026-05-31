import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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

export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  return !!element?.closest("input, textarea, select, [contenteditable='true']");
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

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatRelativeDate(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
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
