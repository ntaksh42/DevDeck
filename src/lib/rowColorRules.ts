// Conditional row color rules (issue #320).
//
// Users define an ordered list of rules; the first rule whose condition matches
// a row decides that row's background tint ("first match wins"). Rules are a
// client-side view preference, persisted in localStorage like the keybinding
// and theme settings, and applied in the Work Item grids.

export type RowColorField = "state" | "type" | "assignedTo" | "title";
export type RowColorOp = "equals" | "contains";
export type RowColorKey = "red" | "orange" | "amber" | "green" | "blue" | "purple" | "gray";

export type RowColorRule = {
  id: string;
  field: RowColorField;
  op: RowColorOp;
  /** Value to compare against; an empty value never matches. */
  value: string;
  color: RowColorKey;
};

export const ROW_COLOR_FIELDS: { value: RowColorField; label: string }[] = [
  { value: "state", label: "State" },
  { value: "type", label: "Type" },
  { value: "assignedTo", label: "Assigned To" },
  { value: "title", label: "Title" },
];

export const ROW_COLOR_OPS: { value: RowColorOp; label: string }[] = [
  { value: "equals", label: "equals" },
  { value: "contains", label: "contains" },
];

// `swatch` styles the picker dot; `rowClass` tints the matching grid row in both
// light and dark themes.
export const ROW_COLORS: {
  value: RowColorKey;
  label: string;
  swatch: string;
  rowClass: string;
}[] = [
  { value: "red", label: "Red", swatch: "bg-red-500", rowClass: "bg-red-100 dark:bg-red-900/30" },
  { value: "orange", label: "Orange", swatch: "bg-orange-500", rowClass: "bg-orange-100 dark:bg-orange-900/30" },
  { value: "amber", label: "Amber", swatch: "bg-amber-500", rowClass: "bg-amber-100 dark:bg-amber-900/30" },
  { value: "green", label: "Green", swatch: "bg-green-500", rowClass: "bg-green-100 dark:bg-green-900/30" },
  { value: "blue", label: "Blue", swatch: "bg-blue-500", rowClass: "bg-blue-100 dark:bg-blue-900/30" },
  { value: "purple", label: "Purple", swatch: "bg-purple-500", rowClass: "bg-purple-100 dark:bg-purple-900/30" },
  { value: "gray", label: "Gray", swatch: "bg-gray-500", rowClass: "bg-gray-200 dark:bg-gray-700/40" },
];

const ROW_COLOR_KEYS = new Set<RowColorKey>(ROW_COLORS.map((c) => c.value));
const ROW_COLOR_FIELD_KEYS = new Set<RowColorField>(ROW_COLOR_FIELDS.map((f) => f.value));
const ROW_COLOR_OP_KEYS = new Set<RowColorOp>(ROW_COLOR_OPS.map((o) => o.value));

export const ROW_COLOR_RULES_STORAGE_KEY = "azdodeck:rowColorRules:v1";
// Emitted on the window when rules change so grids re-read without prop drilling
// (mirrors KEYBINDINGS_CHANGED_EVENT / THEME_CHANGED_EVENT).
export const ROW_COLOR_RULES_CHANGED_EVENT = "azdodeck:row-color-rules-changed";

function isRule(value: unknown): value is RowColorRule {
  if (!value || typeof value !== "object") return false;
  const rule = value as Record<string, unknown>;
  return (
    typeof rule.id === "string" &&
    typeof rule.value === "string" &&
    ROW_COLOR_FIELD_KEYS.has(rule.field as RowColorField) &&
    ROW_COLOR_OP_KEYS.has(rule.op as RowColorOp) &&
    ROW_COLOR_KEYS.has(rule.color as RowColorKey)
  );
}

export function loadRowColorRules(): RowColorRule[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ROW_COLOR_RULES_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRule);
  } catch {
    return [];
  }
}

export function saveRowColorRules(rules: RowColorRule[]): void {
  const valid = rules.filter(isRule);
  if (valid.length === 0) {
    window.localStorage.removeItem(ROW_COLOR_RULES_STORAGE_KEY);
  } else {
    window.localStorage.setItem(ROW_COLOR_RULES_STORAGE_KEY, JSON.stringify(valid));
  }
  window.dispatchEvent(new CustomEvent(ROW_COLOR_RULES_CHANGED_EVENT));
}

/**
 * Returns the Tailwind row tint class of the first rule whose condition matches
 * the given fields, or null when nothing matches. Comparison is
 * case-insensitive; a rule with an empty value or a missing field never matches.
 */
export function matchRowColorClass(
  fields: Partial<Record<RowColorField, string | null | undefined>>,
  rules: RowColorRule[],
): string | null {
  for (const rule of rules) {
    const target = rule.value.trim().toLowerCase();
    if (!target) continue;
    const actual = (fields[rule.field] ?? "").toLowerCase();
    if (!actual) continue;
    const matched = rule.op === "equals" ? actual === target : actual.includes(target);
    if (matched) {
      return ROW_COLORS.find((c) => c.value === rule.color)?.rowClass ?? null;
    }
  }
  return null;
}
