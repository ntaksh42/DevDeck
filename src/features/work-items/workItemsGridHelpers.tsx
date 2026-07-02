import type { ReactNode } from 'react';
import {
  formatRelativeDate,
  type SortDirection,
} from '@/lib/utils';
import { readStoredJson, writeStoredJson, storageKey } from '@/lib/storage';
import type { WorkItemSummary } from '@/lib/azdoCommands';
import { openExternalUrl } from '@/lib/openExternal';

// ─── Grid layout constants ────────────────────────────────────────────────────

export const DEFAULT_WI_COLUMN_WIDTHS = [46, 64, 60, 180, 82, 84, 140, 68];
export const WI_COLUMN_MIN_WIDTHS = [44, 58, 56, 150, 70, 74, 60, 60];
export const WI_COLUMN_MAX_WIDTHS = [120, 200, 180, 720, 300, 260, 400, 160];
export const WI_COLUMN_WIDTHS_STORAGE_KEY = storageKey("azdodeck:layout:wiSearchGridColumnWidths", 3);
export const WI_VISIBLE_COLUMNS_STORAGE_KEY = storageKey("azdodeck:layout:wiSearchGridVisibleColumns", 2);
export const WI_SORT_STORAGE_KEY = storageKey("azdodeck:view:wiSearchGridSort", 1);
export const WI_COLUMN_FILTERS_STORAGE_KEY = storageKey("azdodeck:view:wiSearchGridColumnFilters", 1);
export const DEFAULT_WORK_ITEM_PREVIEW_WIDTH = 440;
// Effectively unbounded: the pane is still capped by the window because the
// preview grid column is minmax(300px, var(--work-item-preview-width)).
export const MAX_WORK_ITEM_PREVIEW_WIDTH = 8192;
export const WORK_ITEM_PREVIEW_WIDTH_STORAGE_KEY = "azdodeck:layout:workItemPreviewWidth";
export const WI_GRID_ROW_HEIGHT = 29;
export const WI_GRID_OVERSCAN = 8;

// ─── Sort types ───────────────────────────────────────────────────────────────

export type WiSortKey =
  | "id"
  | "workItemType"
  | "state"
  | "title"
  | "projectName"
  | "assignedTo"
  | "tags"
  | "changedDate";
export type WiSortState = { key: WiSortKey; direction: SortDirection };

// ─── Row key helpers ──────────────────────────────────────────────────────────

export function workItemSummaryKey(item: Pick<WorkItemSummary, "organizationId" | "projectId" | "id">): string {
  return `${item.organizationId}:${item.projectId}:${item.id}`;
}

// ChangedDate bumps on every revision, so an archived item resurfaces as soon
// as it changes in Azure DevOps.
export function workItemTriageSnapshot(item: WorkItemSummary): string {
  return item.changedDate ?? "";
}

// ─── Sort helpers ─────────────────────────────────────────────────────────────

export const wiSortLabels: Record<WiSortKey, string> = {
  id: "#",
  workItemType: "Type",
  state: "State",
  title: "Title",
  projectName: "Project",
  assignedTo: "Assigned To",
  tags: "Tags",
  changedDate: "Changed",
};

export function compareWorkItems(a: WorkItemSummary, b: WorkItemSummary, key: WiSortKey): number {
  switch (key) {
    case "id":
      return a.id - b.id;
    case "workItemType":
      return (a.workItemType ?? "￿").localeCompare(b.workItemType ?? "￿");
    case "state":
      return (a.state ?? "￿").localeCompare(b.state ?? "￿");
    case "title":
      return a.title.localeCompare(b.title);
    case "projectName":
      return a.projectName.localeCompare(b.projectName);
    case "assignedTo":
      return (a.assignedTo ?? "￿").localeCompare(b.assignedTo ?? "￿");
    case "tags":
      // Empty tags sort last; otherwise compare the raw "tag1; tag2" strings.
      return (a.tags ?? "￿").localeCompare(b.tags ?? "￿");
    case "changedDate":
      return (a.changedDate ?? "").localeCompare(b.changedDate ?? "");
  }
}

// ─── Column registry ──────────────────────────────────────────────────────────

export const WI_GRID_KEYS: WiSortKey[] = [
  "id",
  "workItemType",
  "state",
  "title",
  "projectName",
  "assignedTo",
  "tags",
  "changedDate",
];
export const WI_GRID_REQUIRED_COLUMNS: WiSortKey[] = ["id", "title"];

export function loadVisibleWorkItemColumns(key: string): WiSortKey[] {
  return readStoredJson(
    key,
    (raw) => {
      if (!Array.isArray(raw)) return undefined;
      const visible = raw.filter((value): value is WiSortKey =>
        WI_GRID_KEYS.includes(value as WiSortKey),
      );
      for (const required of WI_GRID_REQUIRED_COLUMNS) {
        if (!visible.includes(required)) visible.push(required);
      }
      return visible.length > 0 ? visible : undefined;
    },
    [...WI_GRID_KEYS],
  );
}

export function defaultWorkItemSort(): WiSortState {
  return { key: "changedDate", direction: "desc" };
}

export function loadWorkItemSort(key: string, fallback: WiSortState): WiSortState {
  return readStoredJson(
    key,
    (raw) => {
      const parsed = raw as Partial<WiSortState> | null;
      if (
        !parsed ||
        !WI_GRID_KEYS.includes(parsed.key as WiSortKey) ||
        (parsed.direction !== "asc" && parsed.direction !== "desc")
      ) {
        return undefined;
      }
      return { key: parsed.key as WiSortKey, direction: parsed.direction };
    },
    fallback,
  );
}

export function loadWorkItemColumnFilters(
  key: string,
): Partial<Record<FilterableColumn, Set<string>>> {
  return readStoredJson(
    key,
    (raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
      const parsed = raw as Record<string, unknown>;
      const filters: Partial<Record<FilterableColumn, Set<string>>> = {};
      for (const column of Object.keys(FILTERABLE_COLUMNS) as FilterableColumn[]) {
        const values = parsed[column];
        if (Array.isArray(values)) {
          const cleaned = values.filter((value): value is string => typeof value === "string");
          // An empty array is a meaningful "none selected" state, distinct from
          // an absent key which means "show all", so preserve it.
          filters[column] = new Set(cleaned);
        }
      }
      return filters;
    },
    {},
  );
}

export function storeWorkItemColumnFilters(
  key: string,
  filters: Partial<Record<FilterableColumn, Set<string>>>,
) {
  const serialized: Partial<Record<FilterableColumn, string[]>> = {};
  for (const column of Object.keys(FILTERABLE_COLUMNS) as FilterableColumn[]) {
    const values = filters[column];
    // Persist a present set even when empty ("none selected"); only an absent
    // key means "show all".
    if (values) serialized[column] = [...values];
  }
  writeStoredJson(key, serialized);
}

export function activeColumnFilterCount(
  filters: Partial<Record<FilterableColumn, Set<string>>>,
): number {
  return (Object.values(filters) as (Set<string> | undefined)[]).filter(
    (values) => values !== undefined,
  ).length;
}

// ─── Cell rendering ───────────────────────────────────────────────────────────

export function workItemCellValue(item: WorkItemSummary, column: WiSortKey): ReactNode {
  switch (column) {
    case "id":
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (item.webUrl) openExternalUrl(item.webUrl);
          }}
          className="truncate text-left font-mono text-xs text-primary hover:underline"
          title={`#${item.id}`}
        >
          #{item.id}
        </button>
      );
    case "workItemType":
      return (
        <span className="truncate text-xs text-muted-foreground" title={item.workItemType ?? undefined}>
          {item.workItemType ?? "—"}
        </span>
      );
    case "state":
      return (
        <span className="truncate text-xs" title={item.state ?? undefined}>
          {item.state ?? "—"}
        </span>
      );
    case "title":
      return (
        <span className="truncate font-medium text-foreground" title={item.title}>
          {item.title}
        </span>
      );
    case "projectName":
      return (
        <span className="truncate text-xs text-muted-foreground" title={item.projectName}>
          {item.projectName}
        </span>
      );
    case "assignedTo":
      return (
        <span
          className="truncate text-xs text-muted-foreground"
          title={item.assignedTo ?? "Unassigned"}
        >
          {item.assignedTo ?? "—"}
        </span>
      );
    case "tags": {
      const tags = splitWorkItemTags(item.tags);
      if (tags.length === 0) {
        return <span className="text-xs text-muted-foreground">—</span>;
      }
      return (
        <div
          className="flex min-w-0 items-center gap-1 overflow-hidden"
          title={tags.join(", ")}
        >
          {tags.map((tag) => (
            <span
              key={tag}
              className="max-w-full shrink-0 truncate rounded border border-border bg-muted px-1.5 text-[11px] leading-[18px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      );
    }
    case "changedDate":
      return (
        <span
          className="text-xs text-muted-foreground"
          title={item.changedDate ? new Date(item.changedDate).toLocaleString() : undefined}
        >
          {item.changedDate ? formatRelativeDate(item.changedDate) : "—"}
        </span>
      );
  }
}

// Azure DevOps stores tags as a single "tag1; tag2; tag3" string. Split it into
// trimmed, non-empty tags so the grid can render one chip per tag.
export function splitWorkItemTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(";")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

export function extraFieldValue(item: WorkItemSummary, referenceName: string): string | null {
  return (
    item.extraFields.find(
      (field) => field.referenceName.toLowerCase() === referenceName.toLowerCase(),
    )?.value ?? null
  );
}

export function extraColumnLabel(referenceName: string): string {
  return referenceName.split(".").pop() || referenceName;
}

export const PRIORITY_REFERENCE_NAME = "Microsoft.VSTS.Common.Priority";

export function setPriorityExtraField(
  extraFields: WorkItemSummary["extraFields"],
  priority: number,
): WorkItemSummary["extraFields"] {
  const value = String(priority);
  const existingIndex = extraFields.findIndex(
    (field) => field.referenceName.toLowerCase() === PRIORITY_REFERENCE_NAME.toLowerCase(),
  );
  if (existingIndex === -1) {
    return [...extraFields, { referenceName: PRIORITY_REFERENCE_NAME, value }];
  }
  return extraFields.map((field, index) =>
    index === existingIndex ? { ...field, value } : field,
  );
}

// ─── Filterable columns ───────────────────────────────────────────────────────

export type FilterableColumn = "workItemType" | "state" | "projectName" | "assignedTo";
export const FILTERABLE_COLUMNS: Record<FilterableColumn, (item: WorkItemSummary) => string> = {
  workItemType: (item) => item.workItemType ?? "(empty)",
  state: (item) => item.state ?? "(empty)",
  projectName: (item) => item.projectName,
  assignedTo: (item) => item.assignedTo ?? "(Unassigned)",
};
export function isFilterableColumn(col: WiSortKey): col is FilterableColumn {
  return col in FILTERABLE_COLUMNS;
}
