import { readStoredJson, writeStoredJson } from "@/lib/storage";

/**
 * Work Item creation templates: a saved set of common field values (type,
 * priority, area path, iteration, tags, …) that can be applied in one click
 * when creating a new work item. Stored in localStorage, shared across
 * organizations/projects (the issue accepts a common store for now).
 */

const WI_TEMPLATES_STORAGE_KEY = "azdodeck:workItemTemplates";

export const MIN_TEMPLATE_PRIORITY = 1;
export const MAX_TEMPLATE_PRIORITY = 4;

export type WorkItemTemplate = {
  id: string;
  name: string;
  /** Marks the template applied automatically when a create form opens. */
  isDefault?: boolean;
  /** Work item type, e.g. "Bug" or "Task". Required to be a usable template. */
  workItemType: string;
  /** Optional title seed for the new work item. */
  title?: string;
  priority?: number;
  areaPath?: string;
  iteration?: string;
  /** Free-form tags; AzDO joins them with "; ". */
  tags?: string[];
};

/** The subset of fields a create form consumes when a template is applied. */
export type WorkItemTemplateFields = {
  workItemType: string;
  title?: string;
  priority?: number;
  areaPath?: string;
  iteration?: string;
  tags: string[];
};

export function newWorkItemTemplateId(): string {
  return `wi-tmpl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (tags.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) continue;
    tags.push(trimmed);
  }
  return tags;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeWorkItemTemplate(value: unknown): WorkItemTemplate | null {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as WorkItemTemplate).id !== "string" ||
    typeof (value as WorkItemTemplate).name !== "string" ||
    typeof (value as WorkItemTemplate).workItemType !== "string"
  ) {
    return null;
  }

  const template = value as WorkItemTemplate;
  const name = template.name.trim();
  const workItemType = template.workItemType.trim();
  if (!name || !workItemType) return null;

  const priorityValue = Number(template.priority);
  const priority =
    Number.isFinite(priorityValue) && priorityValue >= MIN_TEMPLATE_PRIORITY
      ? Math.min(Math.round(priorityValue), MAX_TEMPLATE_PRIORITY)
      : undefined;

  return {
    id: template.id,
    name,
    isDefault: template.isDefault === true,
    workItemType,
    title: normalizeOptionalString(template.title),
    priority,
    areaPath: normalizeOptionalString(template.areaPath),
    iteration: normalizeOptionalString(template.iteration),
    tags: normalizeTags(template.tags),
  };
}

/**
 * Enforces the invariant that at most one template is the default. The last
 * template flagged as default wins, mirroring how the UI toggles defaults.
 */
function withSingleDefault(templates: WorkItemTemplate[]): WorkItemTemplate[] {
  let defaultId: string | null = null;
  for (const template of templates) {
    if (template.isDefault) defaultId = template.id;
  }
  return templates.map((template) => ({
    ...template,
    isDefault: template.id === defaultId ? true : undefined,
  }));
}

export function loadWorkItemTemplates(): WorkItemTemplate[] {
  return readStoredJson<WorkItemTemplate[]>(
    WI_TEMPLATES_STORAGE_KEY,
    (raw) => {
      if (!Array.isArray(raw)) return undefined;
      const templates = raw
        .map(normalizeWorkItemTemplate)
        .filter((template): template is WorkItemTemplate => template !== null);
      return withSingleDefault(templates);
    },
    [],
  );
}

export function saveWorkItemTemplates(templates: WorkItemTemplate[]): void {
  writeStoredJson(WI_TEMPLATES_STORAGE_KEY, withSingleDefault(templates));
}

export function defaultWorkItemTemplate(
  templates: WorkItemTemplate[],
): WorkItemTemplate | null {
  return templates.find((template) => template.isDefault) ?? null;
}

/** Resolves the field set a create form should pre-fill from a template. */
export function templateFields(template: WorkItemTemplate): WorkItemTemplateFields {
  return {
    workItemType: template.workItemType,
    title: template.title,
    priority: template.priority,
    areaPath: template.areaPath,
    iteration: template.iteration,
    tags: template.tags ?? [],
  };
}
