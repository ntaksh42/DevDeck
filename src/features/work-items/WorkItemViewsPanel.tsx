import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Loader2, Pin, PinOff, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import {
  getSavedQuery,
  countWorkItemQuery,
  listWorkItemProjects,
  runWorkItemQuery,
  commandErrorMessage,
  type Organization,
} from '@/lib/azdoCommands';
import { clamp, isEditableTarget, type SortDirection } from '@/lib/utils';
import { ErrorState } from '@/components/StateDisplay';
import { WorkItemsGrid } from './WorkItemsGrid';
import { invalidateWorkItemQueryViews, workItemQueryKeys } from './queryKeys';
const WI_QUERY_VIEWS_STORAGE_KEY = "azdodeck:workItemQueryViews";
type WorkItemQueryView = {
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

function loadWorkItemQueryViews(): WorkItemQueryView[] {
  const value = window.localStorage.getItem(WI_QUERY_VIEWS_STORAGE_KEY);
  if (!value) return defaultWorkItemQueryViews();
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((view): WorkItemQueryView | null => {
        if (
          !view ||
          typeof view.id !== "string" ||
          typeof view.name !== "string" ||
          typeof view.projectId !== "string" ||
          typeof view.wiql !== "string"
        ) {
          return null;
        }
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
      })
      .filter((view): view is WorkItemQueryView => view !== null);
  } catch {
    return [];
  }
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

function firstCustomView(views: WorkItemQueryView[]): WorkItemQueryView | null {
  return views.find((view) => !view.id.startsWith("builtin-")) ?? null;
}

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

function newWorkItemViewId(): string {
  return `wi-view-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultWorkItemWiql(): string {
  return [
    "SELECT [System.Id]",
    "FROM WorkItems",
    "WHERE [System.TeamProject] = @project",
    "ORDER BY [System.ChangedDate] DESC",
  ].join("\n");
}

function parseAzdoQueryUrl(url: string): {
  orgName?: string;
  projectName?: string;
  queryId?: string;
} {
  if (!url.trim()) return {};
  try {
    const u = new URL(url.trim());
    const { hostname, pathname } = u;
    let orgName: string | undefined;
    let projectName: string | undefined;
    let queryId: string | undefined;

    if (hostname === "dev.azure.com") {
      const match = /^\/([^/]+)\/([^/]+)\/_queries\/query(?:-edit)?\/([0-9a-f-]{36})/i.exec(pathname);
      if (match) {
        orgName = decodeURIComponent(match[1]);
        projectName = decodeURIComponent(match[2]);
        queryId = match[3];
      } else {
        const parts = pathname.split("/").filter(Boolean);
        if (parts[0]) orgName = decodeURIComponent(parts[0]);
        if (parts[1]) projectName = decodeURIComponent(parts[1]);
      }
    } else if (hostname.endsWith(".visualstudio.com")) {
      orgName = hostname.split(".")[0];
      const match = /^\/([^/]+)\/_queries\/query(?:-edit)?\/([0-9a-f-]{36})/i.exec(pathname);
      if (match) {
        projectName = decodeURIComponent(match[1]);
        queryId = match[2];
      } else {
        const parts = pathname.split("/").filter(Boolean);
        if (parts[0]) projectName = decodeURIComponent(parts[0]);
      }
    }

    return { orgName, projectName, queryId };
  } catch {
    return {};
  }
}

export function WorkItemViewsPanel({ organizations }: { organizations: Organization[] }) {
  const queryClient = useQueryClient();
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [views, setViews] = useState<WorkItemQueryView[]>(() => loadWorkItemQueryViews());
  const initialSelectedView = firstCustomView(views);
  const [selectedViewId, setSelectedViewId] = useState<string | null>(initialSelectedView?.id ?? null);
  const [editingViewId, setEditingViewId] = useState<string | null>(initialSelectedView?.id ?? null);
  const [draftName, setDraftName] = useState(initialSelectedView?.name ?? "");
  const [draftProjectId, setDraftProjectId] = useState(initialSelectedView?.projectId ?? "");
  const [draftWiql, setDraftWiql] = useState(initialSelectedView?.wiql ?? defaultWorkItemWiql());
  const [draftLimit, setDraftLimit] = useState(String(initialSelectedView?.limit ?? 200));
  const draftNameRef = useRef(draftName);
  const draftProjectIdRef = useRef(draftProjectId);
  const draftWiqlRef = useRef(draftWiql);
  const draftLimitRef = useRef(draftLimit);
  const [draftUrl, setDraftUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const viewButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const viewFormRef = useRef<HTMLFormElement | null>(null);

  const selectedOrganizationId = organizationId || organizations[0]?.id || "";
  const projectsQuery = useQuery({
    queryKey: workItemQueryKeys.projects(selectedOrganizationId),
    queryFn: () => listWorkItemProjects({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
    staleTime: 5 * 60_000,
  });
  const projectOptions = projectsQuery.data ?? [];

  // URL parse: derived from draftUrl
  const urlParsed = useMemo(() => parseAzdoQueryUrl(draftUrl), [draftUrl]);
  const urlQueryId = urlParsed.queryId ?? null;
  const urlProjectName = urlParsed.projectName ?? null;

  const resolvedProjectId = useMemo(
    () =>
      urlProjectName
        ? (projectOptions.find(
            (p) =>
              p.projectName.toLowerCase() === urlProjectName.toLowerCase() ||
              p.projectId.toLowerCase() === urlProjectName.toLowerCase(),
          )?.projectId ?? null)
        : null,
    [urlProjectName, projectOptions],
  );

  const savedQueryFetch = useQuery({
    queryKey: workItemQueryKeys.savedQuery(
      selectedOrganizationId,
      resolvedProjectId,
      urlQueryId,
    ),
    queryFn: () =>
      getSavedQuery({
        organizationId: selectedOrganizationId,
        projectId: resolvedProjectId!,
        queryId: urlQueryId!,
      }),
    enabled: dialogOpen && !!selectedOrganizationId && !!resolvedProjectId && !!urlQueryId,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    window.localStorage.setItem(WI_QUERY_VIEWS_STORAGE_KEY, JSON.stringify(views));
  }, [views]);

  useEffect(() => {
    if (!draftProjectId && projectOptions[0]) {
      setDraftProjectId(projectOptions[0].projectId);
      draftProjectIdRef.current = projectOptions[0].projectId;
    }
  }, [draftProjectId, projectOptions]);

  // Auto-fill project from URL resolution
  useEffect(() => {
    if (!dialogOpen || !resolvedProjectId || !urlQueryId) return;
    setDraftProjectId(resolvedProjectId);
    draftProjectIdRef.current = resolvedProjectId;
  }, [resolvedProjectId, urlQueryId, dialogOpen]);

  // Auto-fill WIQL and name from fetched saved query; guard id to handle cached-ref case
  useEffect(() => {
    const data = savedQueryFetch.data;
    if (!data || data.id !== urlQueryId) return;
    if (data.wiql) {
      setDraftWiql(data.wiql);
      draftWiqlRef.current = data.wiql;
    }
    setDraftName((prev) => {
      if (prev) return prev;
      draftNameRef.current = data.name;
      return data.name;
    });
  }, [savedQueryFetch.data, urlQueryId]);

  useEffect(() => {
    if (selectedViewId && views.some((view) => view.id === selectedViewId)) return;
    const next = firstCustomView(views);
    setSelectedViewId(next?.id ?? null);
    if (next) {
      loadDraft(next);
    }
  }, [selectedViewId, views]);

  const viewCountQueries = useQueries({
    queries: views.map((view) => ({
      queryKey: workItemQueryKeys.queryCount({
        organizationId: selectedOrganizationId,
        viewId: view.id,
        projectId: view.projectId || projectOptions[0]?.projectId,
        wiql: view.wiql,
        limit: view.limit,
      }),
      queryFn: () =>
        countWorkItemQuery({
          organizationId: selectedOrganizationId,
          projectId: view.projectId || projectOptions[0]?.projectId || "",
          wiql: view.wiql,
          limit: view.limit,
        }),
      enabled: !!selectedOrganizationId && !!(view.projectId || projectOptions[0]?.projectId) && !!view.wiql.trim(),
      staleTime: 5 * 60_000,
    })),
  });

  const selectedViewIndex = Math.max(
    0,
    views.findIndex((view) => view.id === selectedViewId),
  );
  const selectedView = views[selectedViewIndex] ?? null;
  const selectedViewProjectId = selectedView?.projectId || projectOptions[0]?.projectId || "";
  const selectedCountQuery = selectedView ? viewCountQueries[selectedViewIndex] : null;
  const selectedQuery = useQuery({
    queryKey: workItemQueryKeys.queryView({
      organizationId: selectedOrganizationId,
      viewId: selectedView?.id,
      projectId: selectedViewProjectId,
      wiql: selectedView?.wiql,
      limit: selectedView?.limit,
    }),
    queryFn: () =>
      runWorkItemQuery({
        organizationId: selectedOrganizationId,
        projectId: selectedViewProjectId,
        wiql: selectedView!.wiql,
        limit: selectedView!.limit,
      }),
    enabled:
      !!selectedView &&
      !!selectedOrganizationId &&
      !!selectedViewProjectId &&
      !!selectedView.wiql.trim(),
    staleTime: 5 * 60_000,
  });
  const selectedResults = selectedQuery?.data ?? [];

  function loadDraft(view: WorkItemQueryView) {
    setEditingViewId(view.id);
    setDraftName(view.name);
    draftNameRef.current = view.name;
    setDraftProjectId(view.projectId);
    draftProjectIdRef.current = view.projectId;
    setDraftWiql(view.wiql);
    draftWiqlRef.current = view.wiql;
    setDraftLimit(String(view.limit));
    draftLimitRef.current = String(view.limit);
    setDraftUrl("");
    setFormError(null);
  }

  function resetDraft() {
    const defaultProjectId = projectOptions[0]?.projectId ?? "";
    const defaultWiql = defaultWorkItemWiql();
    setEditingViewId(null);
    setDraftName("");
    draftNameRef.current = "";
    setDraftProjectId(defaultProjectId);
    draftProjectIdRef.current = defaultProjectId;
    setDraftWiql(defaultWiql);
    draftWiqlRef.current = defaultWiql;
    setDraftLimit("200");
    draftLimitRef.current = "200";
    setDraftUrl("");
    setFormError(null);
  }

  function openAddDialog() {
    resetDraft();
    setDialogOpen(true);
  }

  function openEditDialog(view?: WorkItemQueryView) {
    const target = view ?? selectedView;
    if (!target) return;
    loadDraft(target);
    setDialogOpen(true);
  }

  function handleUrlChange(url: string) {
    setDraftUrl(url);
    if (!url.trim()) return;
    const parsed = parseAzdoQueryUrl(url);
    if (parsed.orgName) {
      const matchedOrg = organizations.find(
        (o) => o.name.toLowerCase() === parsed.orgName!.toLowerCase(),
      );
      if (matchedOrg && matchedOrg.id !== organizationId) {
        setOrganizationId(matchedOrg.id);
        setDraftProjectId("");
        draftProjectIdRef.current = "";
      }
    }
  }

  function urlStatusMessage(): { text: string; severity: "success" | "error" | "info" } | null {
    if (!draftUrl.trim()) return null;
    const hasAzdoHost =
      draftUrl.includes("dev.azure.com") || draftUrl.includes(".visualstudio.com");
    if (!hasAzdoHost) return { text: "Enter an Azure DevOps URL.", severity: "info" };
    if (urlQueryId) {
      if (urlProjectName && !resolvedProjectId && !projectsQuery.isLoading) {
        return { text: `Project "${urlProjectName}" not found.`, severity: "error" };
      }
      if (savedQueryFetch.isFetching) return { text: "Fetching WIQL…", severity: "info" };
      if (savedQueryFetch.isError) {
        return { text: `Fetch error: ${commandErrorMessage(savedQueryFetch.error)}`, severity: "error" };
      }
      if (savedQueryFetch.isSuccess && savedQueryFetch.data.wiql == null) {
        return { text: "No WIQL found at this URL (may be a folder or tree query).", severity: "error" };
      }
      if (savedQueryFetch.isSuccess) return { text: "WIQL fetched.", severity: "success" };
    } else if (urlParsed.orgName ?? urlParsed.projectName) {
      return { text: "Org / Project auto-filled. Enter WIQL manually.", severity: "info" };
    } else {
      return { text: "Azure DevOps query URL not recognized.", severity: "info" };
    }
    return null;
  }

  function saveView(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draftNameRef.current.trim();
    const projectId = draftProjectIdRef.current;
    const wiql = draftWiqlRef.current.trim();
    const limitInput = draftLimitRef.current;
    const limit = clamp(Number(limitInput), 1, 500);
    if (!name) {
      setFormError("View name is required.");
      return;
    }
    if (!projectId) {
      setFormError("Project is required.");
      return;
    }
    if (!wiql) {
      setFormError("WIQL query is required.");
      return;
    }
    if (!Number.isFinite(Number(limitInput))) {
      setFormError("Limit must be a number.");
      return;
    }

    const nextView: WorkItemQueryView = {
      id: editingViewId ?? newWorkItemViewId(),
      name,
      pinned: views.find((view) => view.id === editingViewId)?.pinned ?? false,
      projectId,
      previewVisible: views.find((view) => view.id === editingViewId)?.previewVisible ?? true,
      sortDirection: views.find((view) => view.id === editingViewId)?.sortDirection ?? "desc",
      sortKey: views.find((view) => view.id === editingViewId)?.sortKey ?? "changedDate",
      wiql,
      limit,
    };
    setViews((current) =>
      editingViewId && current.some((view) => view.id === editingViewId)
        ? current.map((view) => (view.id === editingViewId ? nextView : view))
        : [...current, nextView],
    );
    setSelectedViewId(nextView.id);
    setEditingViewId(nextView.id);
    setDraftUrl("");
    setFormError(null);
    setDialogOpen(false);
  }

  function deleteSelectedView() {
    if (!selectedView) return;
    setViews((current) => current.filter((view) => view.id !== selectedView.id));
    resetDraft();
  }

  function updateSelectedView(patch: Partial<WorkItemQueryView>) {
    if (!selectedView) return;
    setViews((current) =>
      current.map((view) =>
        view.id === selectedView.id ? { ...view, ...patch } : view,
      ),
    );
  }

  function toggleSelectedViewPinned() {
    if (!selectedView) return;
    const pinned = !selectedView.pinned;
    setViews((current) => {
      const next = current.map((view) =>
        view.id === selectedView.id ? { ...view, pinned } : view,
      );
      if (!pinned) return next;
      const target = next.find((view) => view.id === selectedView.id);
      if (!target) return next;
      return [target, ...next.filter((view) => view.id !== selectedView.id)];
    });
  }

  function moveSelectedView(delta: number) {
    if (!selectedView) return;
    setViews((current) => {
      const index = current.findIndex((view) => view.id === selectedView.id);
      if (index < 0) return current;
      const nextIndex = clamp(index + delta, 0, current.length - 1);
      if (nextIndex === index) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  }

  function selectViewAt(index: number) {
    const nextIndex = clamp(index, 0, views.length - 1);
    const view = views[nextIndex];
    if (!view) return;
    setSelectedViewId(view.id);
    loadDraft(view);
    viewButtonRefs.current[nextIndex]?.focus();
  }

  function handleViewListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (isEditableTarget(event.target) || views.length === 0) return;
    if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowUp")) {
      event.preventDefault();
      moveSelectedView(-1);
    } else if (event.shiftKey && (event.key === "ArrowRight" || event.key === "ArrowDown")) {
      event.preventDefault();
      moveSelectedView(1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      selectViewAt(selectedViewIndex + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      selectViewAt(selectedViewIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectViewAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectViewAt(views.length - 1);
    } else if (event.key === "Delete") {
      event.preventDefault();
      deleteSelectedView();
    } else if (event.key === "n" || event.key === "N") {
      event.preventDefault();
      openAddDialog();
    } else if (event.key === "e" || event.key === "E") {
      event.preventDefault();
      openEditDialog();
    } else if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      refreshViews();
    }
  }

  const refreshViews = () => {
    invalidateWorkItemQueryViews(queryClient, selectedOrganizationId);
  };

  const selectedCount = selectedCountQuery?.data ?? selectedResults.length;
  const urlStatus = urlStatusMessage();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Views panel — full width, responsive auto-fill grid */}
      <div className="shrink-0 overflow-hidden rounded-md border border-border bg-white">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div>
            <h2 className="text-sm font-semibold">Views</h2>
            <p className="text-xs text-muted-foreground">
              {views.length === 0
                ? "No saved WIQL views"
                : `${views.length} saved view${views.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!selectedView}
              onClick={toggleSelectedViewPinned}
              title={selectedView?.pinned ? "Unpin selected view" : "Pin selected view"}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {selectedView?.pinned ? (
                <PinOff className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Pin className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {selectedView?.pinned ? "Unpin" : "Pin"}
            </button>
            <button
              type="button"
              disabled={!selectedView || selectedViewIndex <= 0}
              onClick={() => moveSelectedView(-1)}
              title="Move selected view left"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={!selectedView || selectedViewIndex >= views.length - 1}
              onClick={() => moveSelectedView(1)}
              title="Move selected view right"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={!selectedView}
              onClick={() =>
                updateSelectedView({
                  previewVisible: selectedView?.previewVisible === false,
                })
              }
              title={selectedView?.previewVisible === false ? "Show preview for this view" : "Hide preview for this view"}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {selectedView?.previewVisible === false ? (
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Preview
            </button>
            <button
              type="button"
              disabled={!selectedView}
              onClick={() => openEditDialog()}
              aria-keyshortcuts="E"
              title="Edit selected view (E)"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={!selectedView}
              onClick={deleteSelectedView}
              aria-keyshortcuts="Delete"
              title="Delete selected view (Del)"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={views.length === 0}
              onClick={refreshViews}
              title="Refresh all views (R)"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-keyshortcuts="N"
              onClick={openAddDialog}
              title="Add new view (N)"
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add
            </button>
          </div>
        </div>

        {views.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            Save a WIQL view to start tracking result counts.
          </div>
        ) : (
          <div
            role="listbox"
            aria-label="Saved work item views"
            data-views-panel="true"
            className="grid gap-3 overflow-auto p-3"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              maxHeight: "min(40vh, 320px)",
            }}
            onKeyDown={handleViewListKeyDown}
          >
            {views.map((view, index) => {
              const query = viewCountQueries[index];
              const count = query?.data ?? 0;
              const selected = selectedView?.id === view.id;
              return (
                <button
                  key={view.id}
                  ref={(element) => {
                    viewButtonRefs.current[index] = element;
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End Delete N E R"
                  onClick={() => {
                    setSelectedViewId(view.id);
                    loadDraft(view);
                  }}
                  onDoubleClick={() => openEditDialog(view)}
                  className={`min-h-[88px] rounded-md border p-3 text-left outline-none transition-colors focus:ring-2 focus:ring-ring ${
                    selected
                      ? "border-primary bg-secondary"
                      : "border-border bg-white hover:bg-muted/60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold" title={view.name}>
                      {view.name}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {view.pinned ? (
                        <Pin className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                      ) : null}
                      {query?.isFetching ? (
                        <Loader2
                          className="h-4 w-4 animate-spin text-muted-foreground"
                          aria-hidden="true"
                        />
                      ) : null}
                    </span>
                  </div>
                  <div className="mt-3 text-3xl font-semibold leading-none">
                    {query?.isError ? "!" : count}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {query?.isError
                      ? commandErrorMessage(query.error)
                      : `${view.limit} max results`}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground/80">
                    {(view.sortKey ?? "changedDate")} {(view.sortDirection ?? "desc").toUpperCase()}
                    {view.previewVisible === false ? " · preview off" : ""}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selectedView && !dialogOpen ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">{selectedView.name}</h2>
              <p className="text-xs text-muted-foreground">
                {selectedQuery?.isFetching
                  ? "Loading query results"
                  : selectedQuery?.isError
                    ? "Query failed"
                    : `${selectedCount} result${selectedCount === 1 ? "" : "s"}`}
              </p>
            </div>
            <span className="rounded-md border border-border bg-white px-2 py-1 font-mono text-xs text-muted-foreground">
              {selectedView.projectId || selectedViewProjectId}
            </span>
          </div>

          {selectedQuery?.isError ? (
            <ErrorState message={commandErrorMessage(selectedQuery.error)} />
          ) : null}

          <WorkItemsGrid
            key={selectedView.id}
            dataUpdatedAt={selectedQuery?.dataUpdatedAt}
            loading={!!selectedQuery?.isFetching}
            results={selectedResults}
            searched={!!selectedQuery}
            autoFocus
            emptyMessage="Select or save a WIQL view to load work items."
            initialSort={{
              key: selectedView.sortKey ?? "changedDate",
              direction: selectedView.sortDirection ?? "desc",
            }}
            onSortChange={(sort) =>
              updateSelectedView({
                sortKey: sort.key,
                sortDirection: sort.direction,
              })
            }
            previewVisible={selectedView.previewVisible !== false}
            storageKeyScope={selectedView.id}
          />
        </div>
      ) : null}

      {/* Add / Edit dialog */}
      {dialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setDialogOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="view-dialog-title"
            className="relative w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-white shadow-xl"
            style={{ maxHeight: "90vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 id="view-dialog-title" className="text-sm font-semibold">
                {editingViewId ? "Edit View" : "Add View"}
              </h2>
              <button
                type="button"
                aria-label="Close dialog"
                onClick={() => setDialogOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form
              ref={viewFormRef}
              className="grid gap-3 p-4"
              onSubmit={saveView}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.preventDefault();
                  viewFormRef.current?.requestSubmit();
                }
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setDialogOpen(false);
                }
              }}
            >
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="view-url-input">
                  Azure DevOps URL
                  <span className="ml-1 font-normal text-muted-foreground/70">
                    (paste to auto-fill Org / Project / WIQL)
                  </span>
                </label>
                <input
                  id="view-url-input"
                  value={draftUrl}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  placeholder="https://dev.azure.com/{org}/{project}/_queries/query/{id}"
                  autoFocus
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                {urlStatus ? (
                  <p
                    className={`text-xs ${
                      urlStatus.severity === "success"
                        ? "text-green-700"
                        : urlStatus.severity === "error"
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }`}
                  >
                    {urlStatus.text}
                  </p>
                ) : null}
              </div>

              {organizations.length > 1 ? (
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Organization</span>
                  <select
                    value={selectedOrganizationId}
                    onChange={(event) => {
                      setOrganizationId(event.target.value);
                      setDraftProjectId("");
                      draftProjectIdRef.current = "";
                    }}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  >
                    {organizations.map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {organization.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Name</span>
                <input
                  value={draftName}
                  onChange={(event) => {
                    setDraftName(event.target.value);
                    draftNameRef.current = event.target.value;
                  }}
                  placeholder="Active bugs"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-[1fr_90px]">
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Project</span>
                  <select
                    value={draftProjectId}
                    disabled={projectsQuery.isLoading || projectOptions.length === 0}
                    onChange={(event) => {
                      setDraftProjectId(event.target.value);
                      draftProjectIdRef.current = event.target.value;
                    }}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                  >
                    <option value="">Select project</option>
                    {projectOptions.map((project) => (
                      <option key={project.projectId} value={project.projectId}>
                        {project.projectName}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Limit</span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={draftLimit}
                    onChange={(event) => {
                      setDraftLimit(event.target.value);
                      draftLimitRef.current = event.target.value;
                    }}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
              </div>

              <div className="grid gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor="view-wiql-input"
                  >
                    WIQL
                  </label>
                  <span className="flex flex-wrap justify-end gap-1">
                    {["@Me", "@Today", "@CurrentIteration", "@Follows"].map((macro) => (
                      <button
                        key={macro}
                        type="button"
                        onClick={() =>
                          setDraftWiql((value) => {
                            const next = `${value}${value.endsWith(" ") || value.endsWith("\n") ? "" : " "}${macro}`;
                            draftWiqlRef.current = next;
                            return next;
                          })
                        }
                        className="rounded border border-border bg-white px-1.5 py-0.5 font-mono text-[10px] hover:bg-secondary"
                      >
                        {macro}
                      </button>
                    ))}
                  </span>
                </div>
                <textarea
                  id="view-wiql-input"
                  value={draftWiql}
                  onChange={(event) => {
                    setDraftWiql(event.target.value);
                    draftWiqlRef.current = event.target.value;
                  }}
                  rows={7}
                  spellCheck={false}
                  className="min-h-[120px] resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-5 outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {formError ? (
                <p role="alert" className="text-xs text-destructive">
                  {formError}
                </p>
              ) : null}

              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setDialogOpen(false)}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {editingViewId ? "Update" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
