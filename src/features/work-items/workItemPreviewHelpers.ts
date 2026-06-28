import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type {
  WorkItemFieldOption,
  WorkItemLinkType,
  WorkItemPreview,
} from "@/lib/azdoCommands";
import { formatRelativeDate } from "@/lib/utils";
import type { CustomPreviewField, PreviewFieldKey } from "./previewFieldsStorage";

export type PreviewFieldDefinition = {
  editable?: "state" | "assignee" | "priority" | "reason";
  key: PreviewFieldKey;
  label: string;
  shortcut?: string;
};

export const PREVIEW_FIELD_DEFINITIONS: PreviewFieldDefinition[] = [
  { key: "state", label: "State", editable: "state", shortcut: "S" },
  { key: "assignedTo", label: "Assigned", editable: "assignee", shortcut: "A" },
  { key: "priority", label: "Priority", editable: "priority", shortcut: "P" },
  { key: "areaPath", label: "Area" },
  { key: "iterationPath", label: "Iteration" },
  { key: "reason", label: "Reason", editable: "reason", shortcut: "R" },
  { key: "severity", label: "Severity" },
  { key: "storyPoints", label: "Points" },
  { key: "remainingWork", label: "Remain" },
  { key: "tags", label: "Tags" },
  { key: "workItemType", label: "Type" },
  { key: "projectName", label: "Project" },
  { key: "createdBy", label: "Created by" },
  { key: "createdDate", label: "Created" },
  { key: "changedDate", label: "Changed" },
];

export const VISIBLE_COMMENT_LIMIT = 20;

export const WORK_ITEM_LINK_TYPES: WorkItemLinkType[] = [
  "Related",
  "Parent",
  "Child",
  "Predecessor",
  "Successor",
];

// Link types the app knows how to remove (their reference name is mapped on the
// backend). Other relation kinds are shown read-only.
export const REMOVABLE_LINK_TYPES = new Set<string>(WORK_ITEM_LINK_TYPES);

export function stopPreviewNavigationKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
  if (
    event.key === 'ArrowDown' ||
    event.key === 'ArrowUp' ||
    event.key === 'ArrowLeft' ||
    event.key === 'ArrowRight' ||
    event.key === 'PageDown' ||
    event.key === 'PageUp' ||
    event.key === 'Home' ||
    event.key === 'End' ||
    event.key === ' '
  ) {
    event.stopPropagation();
  }
}

export function workItemFieldLabel(referenceName: string): string {
  return referenceName.split(".").pop() || referenceName;
}

export function selectedPreviewFieldDefinitions(keys: PreviewFieldKey[]): PreviewFieldDefinition[] {
  const selected = new Set(keys);
  return PREVIEW_FIELD_DEFINITIONS.filter((field) => selected.has(field.key));
}

export function isWidePreviewField(key: PreviewFieldKey): boolean {
  return key === "areaPath" || key === "iterationPath" || key === "tags";
}

export function previewFieldValue(preview: WorkItemPreview, key: PreviewFieldKey): string | null {
  switch (key) {
    case "state":
      return preview.state;
    case "assignedTo":
      return preview.assignedTo;
    case "priority":
      return preview.priority;
    case "areaPath":
      return preview.areaPath;
    case "iterationPath":
      return preview.iterationPath;
    case "reason":
      return preview.reason;
    case "severity":
      return preview.severity;
    case "storyPoints":
      return preview.storyPoints;
    case "remainingWork":
      return preview.remainingWork;
    case "tags":
      return preview.tags;
    case "workItemType":
      return preview.workItemType;
    case "projectName":
      return preview.projectName;
    case "createdBy":
      return preview.createdBy;
    case "createdDate":
      return preview.createdDate ? formatRelativeDate(preview.createdDate) : null;
    case "changedDate":
      return preview.changedDate ? formatRelativeDate(preview.changedDate) : null;
  }
}

export function filterCustomFieldOptions(
  options: WorkItemFieldOption[],
  selectedFields: CustomPreviewField[],
  query: string,
): WorkItemFieldOption[] {
  const selected = new Set(selectedFields.map((field) => field.referenceName.toLowerCase()));
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return options
    .filter((option) => !selected.has(option.referenceName.toLowerCase()))
    .filter((option) => {
      if (terms.length === 0) return option.custom;
      const haystack = `${option.name} ${option.referenceName} ${option.fieldType}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .sort((left, right) =>
      Number(right.custom) - Number(left.custom) ||
      left.name.localeCompare(right.name) ||
      left.referenceName.localeCompare(right.referenceName),
    )
    .slice(0, 20);
}
