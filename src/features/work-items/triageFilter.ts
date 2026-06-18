import type { WorkItemSummary } from "@/lib/azdoCommands";

const PRIORITY_REFERENCE_NAME = "Microsoft.VSTS.Common.Priority";

// States that mean the item is finished; triage only cares about live work.
const TRIAGED_STATES = new Set(["done", "closed", "resolved", "removed"]);

function isUnassigned(item: WorkItemSummary): boolean {
  return !item.assignedTo || item.assignedTo.trim() === "";
}

function isPriorityUnset(item: WorkItemSummary): boolean {
  const field = item.extraFields.find(
    (entry) => entry.referenceName.toLowerCase() === PRIORITY_REFERENCE_NAME.toLowerCase(),
  );
  const raw = field?.value?.trim();
  // Absent field, empty value, or the Azure DevOps "unset" sentinel of 0 all
  // count as no priority.
  if (!raw) return true;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed <= 0;
}

function isActiveState(item: WorkItemSummary): boolean {
  const state = item.state?.trim().toLowerCase();
  if (!state) return true;
  return !TRIAGED_STATES.has(state);
}

// An item needs triage when it is still active and is missing an assignee or a
// priority (or both).
export function needsTriage(item: WorkItemSummary): boolean {
  return isActiveState(item) && (isUnassigned(item) || isPriorityUnset(item));
}

export function filterTriageWorkItems(items: WorkItemSummary[]): WorkItemSummary[] {
  return items.filter(needsTriage);
}
