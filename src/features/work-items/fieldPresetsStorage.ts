export const FIELD_PRESETS_STORAGE_KEY = "azdodeck:workItems:fieldPresets";

// Presets are applied with the digit keys 1-9, so more would be unreachable.
export const MAX_FIELD_PRESETS = 9;

export type WorkItemFieldPresetField = {
  referenceName: string;
  label: string;
  value: string;
};

export type WorkItemFieldPreset = {
  id: string;
  name: string;
  fields: WorkItemFieldPresetField[];
};

export function loadFieldPresets(): WorkItemFieldPreset[] {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(FIELD_PRESETS_STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isValidPreset)
      .slice(0, MAX_FIELD_PRESETS);
  } catch {
    return [];
  }
}

export function storeFieldPresets(presets: WorkItemFieldPreset[]): void {
  window.localStorage.setItem(
    FIELD_PRESETS_STORAGE_KEY,
    JSON.stringify(presets.slice(0, MAX_FIELD_PRESETS)),
  );
}

function isValidPreset(value: unknown): value is WorkItemFieldPreset {
  if (typeof value !== "object" || value === null) return false;
  const preset = value as Partial<WorkItemFieldPreset>;
  return (
    typeof preset.id === "string" &&
    preset.id.length > 0 &&
    typeof preset.name === "string" &&
    preset.name.trim().length > 0 &&
    Array.isArray(preset.fields) &&
    preset.fields.length > 0 &&
    preset.fields.every(
      (field) =>
        typeof field === "object" &&
        field !== null &&
        typeof field.referenceName === "string" &&
        field.referenceName.length > 0 &&
        typeof field.label === "string" &&
        typeof field.value === "string",
    )
  );
}
