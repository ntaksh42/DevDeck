import { MAX_TEMPLATE_PRIORITY, MIN_TEMPLATE_PRIORITY, type WorkItemTemplate } from "./workItemTemplatesStorage";

export type TemplateDraft = {
  name: string;
  workItemType: string;
  title: string;
  priority: string;
  areaPath: string;
  iteration: string;
  tags: string;
};

export function emptyDraft(): TemplateDraft {
  return {
    name: "",
    workItemType: "",
    title: "",
    priority: "",
    areaPath: "",
    iteration: "",
    tags: "",
  };
}

export function draftFromTemplate(template: WorkItemTemplate): TemplateDraft {
  return {
    name: template.name,
    workItemType: template.workItemType,
    title: template.title ?? "",
    priority: template.priority !== undefined ? String(template.priority) : "",
    areaPath: template.areaPath ?? "",
    iteration: template.iteration ?? "",
    tags: (template.tags ?? []).join(", "),
  };
}

export function templateSummary(template: WorkItemTemplate): string {
  const parts = [template.workItemType];
  if (template.priority !== undefined) parts.push(`P${template.priority}`);
  if (template.areaPath) parts.push(template.areaPath);
  if (template.iteration) parts.push(template.iteration);
  if (template.tags && template.tags.length > 0) parts.push(template.tags.join(", "));
  return parts.join(" · ");
}

/** Validates a draft and builds the template to save, or returns the form error. */
export function templateFromDraft(
  draft: TemplateDraft,
  id: string,
  isDefault: boolean | undefined,
): { template: WorkItemTemplate } | { error: string } {
  const name = draft.name.trim();
  const workItemType = draft.workItemType.trim();
  if (!name) return { error: "Template name is required." };
  if (!workItemType) return { error: "Work item type is required." };
  const priorityInput = draft.priority.trim();
  let priority: number | undefined;
  if (priorityInput) {
    const parsed = Number(priorityInput);
    if (!Number.isFinite(parsed) || parsed < MIN_TEMPLATE_PRIORITY || parsed > MAX_TEMPLATE_PRIORITY) {
      return { error: `Priority must be between ${MIN_TEMPLATE_PRIORITY} and ${MAX_TEMPLATE_PRIORITY}.` };
    }
    priority = Math.round(parsed);
  }
  const tags = draft.tags
    .split(/[;,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  return {
    template: {
      id,
      name,
      isDefault,
      workItemType,
      title: draft.title.trim() || undefined,
      priority,
      areaPath: draft.areaPath.trim() || undefined,
      iteration: draft.iteration.trim() || undefined,
      tags,
    },
  };
}
