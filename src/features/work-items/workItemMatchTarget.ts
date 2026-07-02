import type { WorkItemSummary } from "@/lib/azdoCommands";
import type { WorkItemMatchTarget } from "@/lib/searchQuery";

const PRIORITY_REFERENCE_NAME = "Microsoft.VSTS.Common.Priority";
const TAGS_REFERENCE_NAME = "System.Tags";

function extraFieldValue(item: WorkItemSummary, referenceName: string): string | null {
  return (
    item.extraFields.find(
      (field) => field.referenceName.toLowerCase() === referenceName.toLowerCase(),
    )?.value ?? null
  );
}

/**
 * Projects a WorkItemSummary onto the fields the smart-search matcher needs, so
 * both My Work Items and Work Item Search filter results with identical
 * `parseSearchQuery` / `matchesWorkItemQuery` semantics.
 */
export function toMatchTarget(item: WorkItemSummary): WorkItemMatchTarget {
  const priorityRaw = extraFieldValue(item, PRIORITY_REFERENCE_NAME);
  const priority = priorityRaw !== null && priorityRaw.trim() !== "" ? Number(priorityRaw) : NaN;
  // Prefer the first-class `tags` field (populated for cached grid rows); fall
  // back to the extra field for query results that only carry System.Tags there.
  const tagsRaw = item.tags ?? extraFieldValue(item, TAGS_REFERENCE_NAME);
  return {
    id: item.id,
    title: item.title,
    workItemType: item.workItemType,
    state: item.state,
    assignedTo: item.assignedTo,
    projectName: item.projectName,
    priority: Number.isFinite(priority) ? priority : null,
    tags: tagsRaw ? tagsRaw.split(";").map((tag) => tag.trim()).filter(Boolean) : [],
  };
}
