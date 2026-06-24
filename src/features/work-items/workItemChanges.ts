import type { WorkItemPreview } from "@/lib/azdoCommands";
import type { WorkItemFieldPresetField } from "./fieldPresetsStorage";

/**
 * Pure logic for the work item preview's "staged changes" editing model: the
 * pending edits a user accumulates before applying, the inverse set used to undo
 * an apply, and the translation to/from saved field presets. Kept separate from
 * the component so it can be unit-tested without rendering.
 */

export type StagedChanges = {
  state?: string;
  // id/uniqueName are carried along so a successful apply can be recorded in
  // the local assignee history; the undo direction omits them.
  assignee?: { assignValue: string; displayName: string; id?: string; uniqueName?: string | null };
  priority?: number;
  reason?: string;
  tags?: string[];
  fields?: Record<string, { label: string; value: string }>;
};

export type StagedEntry = { key: string; label: string; from: string; to: string };

export function splitWorkItemTags(value: string | null | undefined): string[] {
  // Deduplicate: repeated tags would collide as React keys in the chip list.
  return [
    ...new Set(
      (value ?? "")
        .split(";")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

export function customPreviewFieldValue(
  preview: WorkItemPreview,
  referenceName: string,
): string | null {
  return (
    preview.customFields.find(
      (field) => field.referenceName.toLowerCase() === referenceName.toLowerCase(),
    )?.value ?? null
  );
}

// Builds the change set that restores the work item's pre-apply values.
// Entries whose previous value cannot be restored (e.g. priority that was
// never set) are skipped.
export function buildInverseChanges(
  preview: WorkItemPreview,
  staged: StagedChanges,
): StagedChanges {
  const inverse: StagedChanges = {};
  if (staged.state !== undefined && preview.state) {
    inverse.state = preview.state;
  }
  if (staged.assignee) {
    // Restore the previous assignee unambiguously: send "Display <unique>" when
    // the unique name is known so a duplicate display name does not fail to
    // resolve or land on the wrong person. An empty value clears the assignment
    // (the item was previously unassigned).
    const displayName = preview.assignedTo ?? "";
    const uniqueName = preview.assignedToUniqueName ?? null;
    const assignValue =
      displayName && uniqueName ? `${displayName} <${uniqueName}>` : displayName;
    inverse.assignee = {
      assignValue,
      displayName: preview.assignedTo ?? "Unassigned",
      uniqueName,
    };
  }
  if (staged.priority !== undefined && preview.priority) {
    const previous = Number.parseInt(preview.priority, 10);
    if (Number.isFinite(previous)) inverse.priority = previous;
  }
  if (staged.reason !== undefined && preview.reason) {
    inverse.reason = preview.reason;
  }
  if (staged.tags) {
    inverse.tags = (preview.tags ?? "")
      .split(";")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  for (const referenceName of Object.keys(staged.fields ?? {})) {
    inverse.fields = {
      ...inverse.fields,
      [referenceName]: {
        label: staged.fields![referenceName].label,
        value: customPreviewFieldValue(preview, referenceName) ?? "",
      },
    };
  }
  return inverse;
}

// Serializes pending changes into the flat field list stored in a preset.
// State precedes Reason to mirror applyChangeSet's patch order.
export function presetFieldsFromStaged(staged: StagedChanges): WorkItemFieldPresetField[] {
  const fields: WorkItemFieldPresetField[] = [];
  if (staged.assignee) {
    fields.push({
      referenceName: "System.AssignedTo",
      label: "Assignee",
      value: staged.assignee.assignValue,
    });
  }
  if (staged.priority !== undefined) {
    fields.push({
      referenceName: "Microsoft.VSTS.Common.Priority",
      label: "Priority",
      value: String(staged.priority),
    });
  }
  if (staged.tags) {
    fields.push({ referenceName: "System.Tags", label: "Tags", value: staged.tags.join("; ") });
  }
  for (const [referenceName, field] of Object.entries(staged.fields ?? {})) {
    fields.push({ referenceName, label: field.label, value: field.value });
  }
  if (staged.state !== undefined) {
    fields.push({ referenceName: "System.State", label: "State", value: staged.state });
  }
  if (staged.reason !== undefined) {
    fields.push({ referenceName: "System.Reason", label: "Reason", value: staged.reason });
  }
  return fields;
}

// Maps a preset's fields back onto staged-change slots. Fields that already
// match the work item's current value are skipped so applying a preset twice
// (or to an already-resolved item) stages nothing redundant.
export function stagedChangesFromPresetFields(
  fields: readonly WorkItemFieldPresetField[],
  preview: WorkItemPreview | null,
): StagedChanges {
  const staged: StagedChanges = {};
  for (const field of fields) {
    const referenceName = field.referenceName.toLowerCase();
    if (referenceName === "system.state") {
      if (field.value !== preview?.state) staged.state = field.value;
    } else if (referenceName === "system.reason") {
      if (field.value !== preview?.reason) staged.reason = field.value;
    } else if (referenceName === "system.assignedto") {
      if (field.value !== preview?.assignedTo) {
        staged.assignee = { assignValue: field.value, displayName: field.value };
      }
    } else if (referenceName === "microsoft.vsts.common.priority") {
      const priority = Number.parseInt(field.value, 10);
      if (Number.isFinite(priority) && String(priority) !== preview?.priority) {
        staged.priority = priority;
      }
    } else if (referenceName === "system.tags") {
      const tags = splitWorkItemTags(field.value);
      if (tags.join("; ") !== (preview?.tags ?? "")) staged.tags = tags;
    } else if (
      !preview ||
      (customPreviewFieldValue(preview, field.referenceName) ?? "") !== field.value
    ) {
      staged.fields = {
        ...staged.fields,
        [field.referenceName]: { label: field.label, value: field.value },
      };
    }
  }
  return staged;
}

// The field set copied when duplicating a work item into a new draft. Mirrors
// the create form's preset inputs; comments, attachments, and the source id are
// intentionally excluded so the new item starts clean.
export type WorkItemDuplicateDraft = {
  organizationId: string;
  projectId: string;
  title: string;
  workItemType: string | null;
  priority: string | null;
  areaPath: string | null;
  iterationPath: string | null;
  tags: string[];
  assignedTo: string | null;
};

export const DUPLICATE_TITLE_PREFIX = "[Copy] ";

// Builds the preset draft used to open the create form for a duplicate. Reads
// the source preview only; the returned object shares no references with it, so
// editing the draft never mutates the original work item.
export function buildDuplicateDraft(preview: WorkItemPreview): WorkItemDuplicateDraft {
  return {
    organizationId: preview.organizationId,
    projectId: preview.projectId,
    title: `${DUPLICATE_TITLE_PREFIX}${preview.title}`,
    workItemType: preview.workItemType,
    priority: preview.priority,
    areaPath: preview.areaPath,
    iterationPath: preview.iterationPath,
    tags: splitWorkItemTags(preview.tags),
    assignedTo: preview.assignedTo,
  };
}

// Computes the from/to rows shown in the staged-changes summary.
export function stagedEntriesForPreview(
  preview: WorkItemPreview | null | undefined,
  staged: StagedChanges,
): StagedEntry[] {
  const entries: StagedEntry[] = [];
  if (!preview) return entries;
  if (staged.state !== undefined) {
    entries.push({ key: "state", label: "State", from: preview.state ?? "—", to: staged.state });
  }
  if (staged.assignee) {
    entries.push({
      key: "assignee",
      label: "Assignee",
      from: preview.assignedTo ?? "Unassigned",
      to: staged.assignee.displayName,
    });
  }
  if (staged.priority !== undefined) {
    entries.push({
      key: "priority",
      label: "Priority",
      from: preview.priority ?? "—",
      to: String(staged.priority),
    });
  }
  if (staged.reason !== undefined) {
    entries.push({ key: "reason", label: "Reason", from: preview.reason ?? "—", to: staged.reason });
  }
  if (staged.tags) {
    entries.push({
      key: "tags",
      label: "Tags",
      from: preview.tags?.trim() ? preview.tags : "—",
      to: staged.tags.join("; ") || "—",
    });
  }
  for (const [referenceName, field] of Object.entries(staged.fields ?? {})) {
    entries.push({
      key: `field:${referenceName}`,
      label: field.label,
      from: customPreviewFieldValue(preview, referenceName) ?? "—",
      to: field.value,
    });
  }
  return entries;
}
