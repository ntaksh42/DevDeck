import { formatRelativeDate } from "@/lib/utils";
import { isValidFieldReferenceName } from "./previewFieldsStorage";
import { readStoredJson, writeStoredJson, storageKey } from "@/lib/storage";

/**
 * Grid columns backed by an arbitrary Azure DevOps field. A view stores the
 * reference name plus the field type reported by `list_work_item_fields`, so
 * cells can be formatted and sorted by type instead of as raw strings.
 */
export type ExtraColumn = {
  referenceName: string;
  /** Azure DevOps field type, e.g. "dateTime". Absent for pre-typed views. */
  fieldType?: string;
};

export const MAX_VIEW_EXTRA_COLUMNS = 20;

export const DEFAULT_EXTRA_COLUMN_WIDTH = 120;
export const MIN_EXTRA_COLUMN_WIDTH = 60;
export const MAX_EXTRA_COLUMN_WIDTH = 480;

// Keyed by reference name rather than by view so the same field keeps its width
// everywhere it is shown.
const EXTRA_COLUMN_WIDTHS_STORAGE_KEY = storageKey(
  "azdodeck:layout:wiExtraColumnWidths",
  1,
);

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Accepts both the legacy `string[]` shape and the typed object shape, so views
 * saved before field types were recorded keep working (untyped columns fall
 * back to string formatting and comparison).
 */
export function normalizeExtraColumns(value: unknown): ExtraColumn[] {
  if (!Array.isArray(value)) return [];
  const columns: ExtraColumn[] = [];
  for (const entry of value) {
    const column = normalizeExtraColumn(entry);
    if (!column) continue;
    if (
      columns.some(
        (existing) =>
          existing.referenceName.toLowerCase() === column.referenceName.toLowerCase(),
      )
    ) {
      continue;
    }
    columns.push(column);
    if (columns.length >= MAX_VIEW_EXTRA_COLUMNS) break;
  }
  return columns;
}

function normalizeExtraColumn(value: unknown): ExtraColumn | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return isValidFieldReferenceName(trimmed) ? { referenceName: trimmed } : null;
  }
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ExtraColumn>;
  const referenceName = typeof raw.referenceName === "string" ? raw.referenceName.trim() : "";
  if (!isValidFieldReferenceName(referenceName)) return null;
  const fieldType = typeof raw.fieldType === "string" ? raw.fieldType.trim() : "";
  return fieldType ? { referenceName, fieldType } : { referenceName };
}

export function extraColumnReferenceNames(columns: ExtraColumn[]): string[] {
  return columns.map((column) => column.referenceName);
}

export function extraColumnLabel(referenceName: string): string {
  return referenceName.split(".").pop() || referenceName;
}

export function extraColumnKey(referenceName: string): string {
  return `extra:${referenceName.toLowerCase()}`;
}

export function isExtraColumnKey(key: string): boolean {
  return key.startsWith("extra:");
}

/** Resolves a grid sort key back to the column it came from, if any. */
export function extraColumnForKey(
  key: string,
  columns: ExtraColumn[],
): ExtraColumn | null {
  if (!isExtraColumnKey(key)) return null;
  const referenceName = key.slice("extra:".length);
  return (
    columns.find((column) => column.referenceName.toLowerCase() === referenceName) ?? null
  );
}

// ─── Value formatting ─────────────────────────────────────────────────────────

/** Field types whose values sort numerically rather than lexicographically. */
const NUMERIC_FIELD_TYPES = new Set(["integer", "double", "picklistinteger", "picklistdouble"]);
const DATE_FIELD_TYPES = new Set(["datetime", "date"]);
const HTML_FIELD_TYPES = new Set(["html", "history"]);

export type ExtraColumnValueKind = "number" | "date" | "boolean" | "text";

export function extraColumnValueKind(fieldType: string | undefined): ExtraColumnValueKind {
  const normalized = (fieldType ?? "").toLowerCase();
  if (NUMERIC_FIELD_TYPES.has(normalized)) return "number";
  if (DATE_FIELD_TYPES.has(normalized)) return "date";
  if (normalized === "boolean") return "boolean";
  return "text";
}

/**
 * Turns a raw field value into what the cell shows. Dates become relative
 * ("3d ago"), booleans read as Yes/No, and HTML fields are stripped to plain
 * text so service markup never leaks into the grid.
 */
export function formatExtraColumnValue(
  value: string | null,
  fieldType: string | undefined,
): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const normalized = (fieldType ?? "").toLowerCase();
  if (HTML_FIELD_TYPES.has(normalized)) {
    const text = stripHtml(trimmed);
    return text.length > 0 ? text : null;
  }
  switch (extraColumnValueKind(fieldType)) {
    case "date": {
      const timestamp = Date.parse(trimmed);
      return Number.isNaN(timestamp) ? trimmed : formatRelativeDate(trimmed);
    }
    case "boolean":
      if (trimmed.toLowerCase() === "true") return "Yes";
      if (trimmed.toLowerCase() === "false") return "No";
      return trimmed;
    default:
      return trimmed;
  }
}

/** The `title` attribute: the full, unabbreviated value behind the cell text. */
export function extraColumnValueTitle(
  value: string | null,
  fieldType: string | undefined,
): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (extraColumnValueKind(fieldType) === "date") {
    const timestamp = Date.parse(trimmed);
    if (!Number.isNaN(timestamp)) return new Date(timestamp).toLocaleString();
  }
  const normalized = (fieldType ?? "").toLowerCase();
  if (HTML_FIELD_TYPES.has(normalized)) return stripHtml(trimmed) || undefined;
  return trimmed;
}

// Grid cells show a one-line summary, so the markup is discarded entirely
// rather than sanitized and rendered (the preview pane does that instead).
function stripHtml(value: string): string {
  if (typeof document === "undefined") {
    return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  const container = document.createElement("div");
  container.innerHTML = value;
  return (container.textContent ?? "").replace(/\s+/g, " ").trim();
}

// ─── Sorting ──────────────────────────────────────────────────────────────────

/**
 * Compares two raw field values by type.
 *
 * Empty values compare as "greater" so ascending order puts them last; the
 * grid negates this result for descending order, so use
 * `compareExtraColumnValuesDirected` to keep blanks at the bottom either way.
 */
export function compareExtraColumnValues(
  left: string | null,
  right: string | null,
  fieldType: string | undefined,
): number {
  const a = left?.trim() ?? "";
  const b = right?.trim() ?? "";
  if (a.length === 0 || b.length === 0) {
    if (a.length === b.length) return 0;
    return a.length === 0 ? 1 : -1;
  }
  switch (extraColumnValueKind(fieldType)) {
    case "number": {
      const numberA = Number(a);
      const numberB = Number(b);
      if (Number.isNaN(numberA) || Number.isNaN(numberB)) break;
      return numberA - numberB;
    }
    case "date": {
      const timeA = Date.parse(a);
      const timeB = Date.parse(b);
      if (Number.isNaN(timeA) || Number.isNaN(timeB)) break;
      return timeA - timeB;
    }
    case "boolean": {
      const boolA = a.toLowerCase() === "true" ? 1 : 0;
      const boolB = b.toLowerCase() === "true" ? 1 : 0;
      return boolA - boolB;
    }
  }
  return a.localeCompare(b);
}

/**
 * Direction-aware comparison for extra columns: blanks stay at the bottom in
 * both directions, so reversing the sort never fills the top of the grid with
 * empty cells. Returns a value already oriented for `direction`.
 */
export function compareExtraColumnValuesDirected(
  left: string | null,
  right: string | null,
  fieldType: string | undefined,
  direction: "asc" | "desc",
): number {
  const aEmpty = (left?.trim() ?? "").length === 0;
  const bEmpty = (right?.trim() ?? "").length === 0;
  if (aEmpty || bEmpty) {
    if (aEmpty === bEmpty) return 0;
    return aEmpty ? 1 : -1;
  }
  const result = compareExtraColumnValues(left, right, fieldType);
  return direction === "asc" ? result : -result;
}

// ─── Width persistence ────────────────────────────────────────────────────────

export function loadExtraColumnWidths(): Record<string, number> {
  return readStoredJson(
    EXTRA_COLUMN_WIDTHS_STORAGE_KEY,
    (raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
      const widths: Record<string, number> = {};
      for (const [referenceName, width] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof width !== "number" || !Number.isFinite(width)) continue;
        widths[referenceName.toLowerCase()] = clampExtraColumnWidth(width);
      }
      return widths;
    },
    {},
  );
}

export function storeExtraColumnWidths(widths: Record<string, number>): void {
  writeStoredJson(EXTRA_COLUMN_WIDTHS_STORAGE_KEY, widths);
}

export function clampExtraColumnWidth(width: number): number {
  return Math.round(
    Math.min(MAX_EXTRA_COLUMN_WIDTH, Math.max(MIN_EXTRA_COLUMN_WIDTH, width)),
  );
}

export function extraColumnWidth(
  widths: Record<string, number>,
  referenceName: string,
): number {
  return widths[referenceName.toLowerCase()] ?? DEFAULT_EXTRA_COLUMN_WIDTH;
}

// ─── Per-screen column selection ──────────────────────────────────────────────

// Screens without saved views (Search, My Work Items) keep their own column
// choice here; view-backed grids store it on the view instead.
const EXTRA_COLUMN_SELECTION_PREFIX = storageKey(
  "azdodeck:layout:wiExtraColumnSelection",
  1,
);

export function loadExtraColumnSelection(scope: string): ExtraColumn[] {
  return readStoredJson(
    `${EXTRA_COLUMN_SELECTION_PREFIX}:${scope}`,
    (raw) => normalizeExtraColumns(raw),
    [],
  );
}

export function storeExtraColumnSelection(scope: string, columns: ExtraColumn[]): void {
  writeStoredJson(`${EXTRA_COLUMN_SELECTION_PREFIX}:${scope}`, columns);
}
