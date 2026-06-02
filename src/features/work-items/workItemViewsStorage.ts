import { clamp, type SortDirection } from "@/lib/utils";

export const WI_QUERY_VIEWS_STORAGE_KEY = "azdodeck:workItemQueryViews";
export const WI_QUERY_VIEWS_EXPORT_SCHEMA = "azdodeck.workItemViews";

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
};

export type WorkItemQueryViewsExport = {
  schema: typeof WI_QUERY_VIEWS_EXPORT_SCHEMA;
  version: 1;
  exportedAt: string;
  views: WorkItemQueryView[];
};

export function isWorkItemSortKey(value: unknown): value is NonNullable<WorkItemQueryView["sortKey"]> {
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

export function defaultWorkItemQueryViews(): WorkItemQueryView[] {
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
