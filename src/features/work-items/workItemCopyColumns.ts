import type { WorkItemSummary } from "@/lib/azdoCommands";
import type { CopyColumn } from "@/lib/clipboardTable";
import { formatDate } from "@/lib/utils";
import {
  extraColumnLabel,
  extraFieldValue,
  wiSortLabels,
  type WiSortKey,
} from "./workItemsGridHelpers";

function cellText(item: WorkItemSummary, key: WiSortKey): string {
  switch (key) {
    case "id":
      return `#${item.id}`;
    case "workItemType":
      return item.workItemType ?? "";
    case "state":
      return item.state ?? "";
    case "title":
      return item.title;
    case "projectName":
      return item.projectName;
    case "assignedTo":
      return item.assignedTo ?? "";
    case "tags":
      return item.tags ?? "";
    case "changedDate":
      return item.changedDate ? formatDate(item.changedDate) : "";
  }
}

// Mirrors what the grid shows: the visible columns in their on-screen order,
// followed by the view's extra field columns.
export function workItemCopyColumns(
  visibleColumns: WiSortKey[],
  extraColumns: string[],
): CopyColumn<WorkItemSummary>[] {
  return [
    ...visibleColumns.map((key) => ({
      label: wiSortLabels[key],
      text: (item: WorkItemSummary) => cellText(item, key),
      href: key === "id" || key === "title" ? (item: WorkItemSummary) => item.webUrl : undefined,
    })),
    ...extraColumns.map((referenceName) => ({
      label: extraColumnLabel(referenceName),
      text: (item: WorkItemSummary) => extraFieldValue(item, referenceName) ?? "",
    })),
  ];
}
