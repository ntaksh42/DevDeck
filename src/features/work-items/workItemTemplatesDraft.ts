import { type WorkItemTemplate } from "./workItemTemplatesStorage";

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
