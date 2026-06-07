export const PREVIEW_FIELDS_STORAGE_KEY = "azdodeck:workItems:previewFields";
export const PREVIEW_CUSTOM_FIELDS_STORAGE_KEY = "azdodeck:workItems:previewCustomFields";

export type PreviewFieldKey =
  | "state"
  | "assignedTo"
  | "priority"
  | "areaPath"
  | "iterationPath"
  | "reason"
  | "severity"
  | "storyPoints"
  | "remainingWork"
  | "tags"
  | "workItemType"
  | "projectName"
  | "createdBy"
  | "createdDate"
  | "changedDate";

export type CustomPreviewField = {
  referenceName: string;
  label: string;
};

export const DEFAULT_PREVIEW_FIELD_KEYS: PreviewFieldKey[] = [
  "state",
  "assignedTo",
  "priority",
  "areaPath",
  "iterationPath",
  "reason",
];

const PREVIEW_FIELD_KEYS: PreviewFieldKey[] = [
  "state",
  "assignedTo",
  "priority",
  "areaPath",
  "iterationPath",
  "reason",
  "severity",
  "storyPoints",
  "remainingWork",
  "tags",
  "workItemType",
  "projectName",
  "createdBy",
  "createdDate",
  "changedDate",
];

const PREVIEW_FIELD_KEY_SET = new Set<PreviewFieldKey>(PREVIEW_FIELD_KEYS);
const FIELD_REFERENCE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;
const MAX_CUSTOM_PREVIEW_FIELDS = 20;

export function loadPreviewFieldKeys(): PreviewFieldKey[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PREVIEW_FIELDS_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return DEFAULT_PREVIEW_FIELD_KEYS;
    const keys = parsed.filter(
      (value): value is PreviewFieldKey =>
        typeof value === "string" && PREVIEW_FIELD_KEY_SET.has(value as PreviewFieldKey),
    );
    return keys.length > 0 ? keys : DEFAULT_PREVIEW_FIELD_KEYS;
  } catch {
    return DEFAULT_PREVIEW_FIELD_KEYS;
  }
}

export function storePreviewFieldKeys(keys: PreviewFieldKey[]) {
  window.localStorage.setItem(PREVIEW_FIELDS_STORAGE_KEY, JSON.stringify(keys));
}

export function loadCustomPreviewFields(): CustomPreviewField[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PREVIEW_CUSTOM_FIELDS_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return dedupeCustomPreviewFields(
      parsed
        .map(normalizeCustomPreviewField)
        .filter((field): field is CustomPreviewField => field !== null),
    );
  } catch {
    return [];
  }
}

export function storeCustomPreviewFields(fields: CustomPreviewField[]) {
  window.localStorage.setItem(
    PREVIEW_CUSTOM_FIELDS_STORAGE_KEY,
    JSON.stringify(dedupeCustomPreviewFields(fields)),
  );
}

export function isValidFieldReferenceName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length <= 128 && FIELD_REFERENCE_NAME_PATTERN.test(trimmed);
}

function normalizeCustomPreviewField(value: unknown): CustomPreviewField | null {
  if (!value || typeof value !== "object") return null;
  const field = value as Partial<CustomPreviewField>;
  const referenceName = typeof field.referenceName === "string" ? field.referenceName.trim() : "";
  const label = typeof field.label === "string" ? field.label.trim() : "";
  if (!isValidFieldReferenceName(referenceName)) return null;
  return {
    referenceName,
    label: label || referenceName,
  };
}

function dedupeCustomPreviewFields(fields: CustomPreviewField[]): CustomPreviewField[] {
  const seen = new Set<string>();
  const result: CustomPreviewField[] = [];
  for (const field of fields) {
    const normalized = normalizeCustomPreviewField(field);
    if (!normalized) continue;
    const key = normalized.referenceName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= MAX_CUSTOM_PREVIEW_FIELDS) break;
  }
  return result;
}
