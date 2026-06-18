import { clamp, type SortDirection } from "@/lib/utils";
import { isValidFieldReferenceName } from "./previewFieldsStorage";

// Bare keys (no migration to date). On an incompatible shape change, bump with
// `storageKey(name, version)` from "@/lib/storage" instead of a hand-spelled
// `:vN` suffix.
const WI_QUERY_VIEWS_STORAGE_KEY = "azdodeck:workItemQueryViews";
const WI_QUERY_VIEWS_EXPORT_SCHEMA = "azdodeck.workItemViews";
export const WI_VIEW_COUNT_BASELINES_STORAGE_KEY = "azdodeck:workItems:viewCountBaselines";

export const MIN_VIEW_REFRESH_INTERVAL_SEC = 15;
export const MAX_VIEW_REFRESH_INTERVAL_SEC = 3600;

export type WorkItemQueryView = {
  id: string;
  name: string;
  pinned?: boolean;
  projectId: string;
  previewVisible?: boolean;
  sortDirection?: SortDirection;
  sortKey?: "id" | "workItemType" | "state" | "title" | "projectName" | "assignedTo" | "changedDate";
  wiql: string;
  limit: number;
  refreshIntervalSec?: number;
  alertThreshold?: number;
  extraColumns?: string[];
};

const MAX_VIEW_EXTRA_COLUMNS = 20;

export function normalizeViewExtraColumns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const columns: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!isValidFieldReferenceName(trimmed)) continue;
    if (columns.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) continue;
    columns.push(trimmed);
    if (columns.length >= MAX_VIEW_EXTRA_COLUMNS) break;
  }
  return columns;
}

export type WorkItemQueryViewsExport = {
  schema: typeof WI_QUERY_VIEWS_EXPORT_SCHEMA;
  version: 1;
  exportedAt: string;
  views: WorkItemQueryView[];
};

function isWorkItemSortKey(value: unknown): value is NonNullable<WorkItemQueryView["sortKey"]> {
  return (
    value === "id" ||
    value === "workItemType" ||
    value === "state" ||
    value === "title" ||
    value === "projectName" ||
    value === "assignedTo" ||
    value === "changedDate"
  );
}

function defaultWorkItemQueryViews(): WorkItemQueryView[] {
  return [
    {
      id: "builtin-assigned-to-me",
      name: "Assigned to me",
      pinned: true,
      previewVisible: true,
      projectId: "",
      sortDirection: "desc",
      sortKey: "changedDate",
      wiql: [
        "SELECT [System.Id]",
        "FROM WorkItems",
        "WHERE [System.AssignedTo] = @Me",
        "ORDER BY [System.ChangedDate] DESC",
      ].join("\n"),
      limit: 200,
    },
    {
      id: "builtin-following",
      name: "Following",
      pinned: true,
      previewVisible: true,
      projectId: "",
      sortDirection: "desc",
      sortKey: "changedDate",
      wiql: [
        "SELECT [System.Id]",
        "FROM WorkItems",
        "WHERE [System.Id] IN (@Follows)",
        "ORDER BY [System.ChangedDate] DESC",
      ].join("\n"),
      limit: 200,
    },
    {
      id: "builtin-mentioned",
      name: "Mentioned",
      previewVisible: true,
      projectId: "",
      sortDirection: "desc",
      sortKey: "changedDate",
      wiql: [
        "SELECT [System.Id]",
        "FROM WorkItems",
        "WHERE [System.History] CONTAINS WORDS @Me",
        "ORDER BY [System.ChangedDate] DESC",
      ].join("\n"),
      limit: 200,
    },
    {
      id: "builtin-my-activity",
      name: "My activity",
      previewVisible: true,
      projectId: "",
      sortDirection: "desc",
      sortKey: "changedDate",
      wiql: [
        "SELECT [System.Id]",
        "FROM WorkItems",
        "WHERE [System.ChangedBy] = @Me OR [System.CreatedBy] = @Me",
        "ORDER BY [System.ChangedDate] DESC",
      ].join("\n"),
      limit: 200,
    },
  ];
}

export function normalizeWorkItemQueryView(value: unknown): WorkItemQueryView | null {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as WorkItemQueryView).id !== "string" ||
    typeof (value as WorkItemQueryView).name !== "string" ||
    typeof (value as WorkItemQueryView).projectId !== "string" ||
    typeof (value as WorkItemQueryView).wiql !== "string"
  ) {
    return null;
  }

  const view = value as WorkItemQueryView;
  const limit = Number(view.limit);
  const refreshIntervalSec = Number(view.refreshIntervalSec);
  const alertThreshold = Number(view.alertThreshold);
  return {
    id: view.id,
    name: view.name,
    pinned: view.pinned === true,
    projectId: view.projectId,
    previewVisible: view.previewVisible !== false,
    sortDirection: view.sortDirection === "asc" || view.sortDirection === "desc"
      ? view.sortDirection
      : "desc",
    sortKey: isWorkItemSortKey(view.sortKey) ? view.sortKey : "changedDate",
    wiql: view.wiql,
    limit: Number.isFinite(limit) ? clamp(limit, 1, 500) : 200,
    refreshIntervalSec:
      Number.isFinite(refreshIntervalSec) && refreshIntervalSec > 0
        ? clamp(
            Math.round(refreshIntervalSec),
            MIN_VIEW_REFRESH_INTERVAL_SEC,
            MAX_VIEW_REFRESH_INTERVAL_SEC,
          )
        : undefined,
    alertThreshold:
      Number.isFinite(alertThreshold) && alertThreshold >= 0
        ? Math.round(alertThreshold)
        : undefined,
    extraColumns: normalizeViewExtraColumns(view.extraColumns),
  };
}

export function loadWorkItemQueryViews(): WorkItemQueryView[] {
  if (typeof window === "undefined") return defaultWorkItemQueryViews();
  const value = window.localStorage.getItem(WI_QUERY_VIEWS_STORAGE_KEY);
  if (!value) return defaultWorkItemQueryViews();
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeWorkItemQueryView)
      .filter((view): view is WorkItemQueryView => view !== null);
  } catch {
    return [];
  }
}

export function saveWorkItemQueryViews(views: WorkItemQueryView[]): void {
  window.localStorage.setItem(WI_QUERY_VIEWS_STORAGE_KEY, JSON.stringify(views));
}

// Counts recorded at the end of the previous session, frozen once per session so
// the delta badge keeps comparing against "last time I looked" while new counts
// are persisted for the next session.
let sessionCountBaselines: Record<string, number> | null = null;

function loadStoredViewCounts(): Record<string, number> {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(WI_VIEW_COUNT_BASELINES_STORAGE_KEY) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const counts: Record<string, number> = {};
    for (const [id, count] of Object.entries(parsed)) {
      if (typeof count === "number" && Number.isFinite(count)) counts[id] = count;
    }
    return counts;
  } catch {
    return {};
  }
}

export function viewCountBaseline(viewId: string): number | null {
  if (sessionCountBaselines === null) sessionCountBaselines = loadStoredViewCounts();
  return sessionCountBaselines[viewId] ?? null;
}

export function recordViewCount(viewId: string, count: number, knownViewIds: string[]): void {
  if (sessionCountBaselines === null) sessionCountBaselines = loadStoredViewCounts();
  const stored = loadStoredViewCounts();
  const next: Record<string, number> = {};
  for (const id of knownViewIds) {
    if (typeof stored[id] === "number") next[id] = stored[id];
  }
  next[viewId] = count;
  window.localStorage.setItem(WI_VIEW_COUNT_BASELINES_STORAGE_KEY, JSON.stringify(next));
}

export function resetViewCountSessionForTests(): void {
  sessionCountBaselines = null;
}

export function createWorkItemQueryViewsExport(views: WorkItemQueryView[]): WorkItemQueryViewsExport {
  return {
    schema: WI_QUERY_VIEWS_EXPORT_SCHEMA,
    version: 1,
    exportedAt: new Date().toISOString(),
    views,
  };
}

export function parseWorkItemQueryViewsImport(text: string): WorkItemQueryView[] {
  const parsed = JSON.parse(text);
  const rawViews: unknown[] | null = Array.isArray(parsed)
    ? parsed
    : parsed?.schema === WI_QUERY_VIEWS_EXPORT_SCHEMA && Array.isArray(parsed.views)
      ? parsed.views
      : null;
  if (!rawViews) {
    throw new Error("JSON must be an AzDoDeck work item view export.");
  }
  const views = rawViews
    .map(normalizeWorkItemQueryView)
    .filter((view): view is WorkItemQueryView => view !== null);
  if (views.length === 0) {
    throw new Error("No valid work item views found in JSON.");
  }
  return views;
}
