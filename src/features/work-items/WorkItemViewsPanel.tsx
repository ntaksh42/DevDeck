import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Copy, Download, Eye, EyeOff, Loader2, Pin, PinOff, Play, Plus, Trash2, Upload, X } from 'lucide-react';
import {
  getSavedQuery,
  countWorkItemQuery,
  listWorkItemFields,
  listWorkItemProjects,
  runWorkItemQuery,
  commandErrorMessage,
  type Organization,
} from '@/lib/azdoCommands';
import { clamp, isEditableTarget } from '@/lib/utils';
import { ErrorState } from '@/components/StateDisplay';
import { WorkItemsGrid } from './WorkItemsGrid';
import { invalidateWorkItemQueryViews, workItemQueryKeys } from './queryKeys';
import {
  MAX_VIEW_REFRESH_INTERVAL_SEC,
  MIN_VIEW_REFRESH_INTERVAL_SEC,
  createWorkItemQueryViewsExport,
  loadWorkItemQueryViews,
  normalizeViewExtraColumns,
  parseWorkItemQueryViewsImport,
  recordViewCount,
  saveWorkItemQueryViews,
  viewCountBaseline,
  type WorkItemQueryView,
} from './workItemViewsStorage';

type WiqlCompletion = {
  label: string;
  value: string;
  detail: string;
};

const WIQL_COMPLETIONS: WiqlCompletion[] = [
  { label: "System.Id", value: "[System.Id]", detail: "Work item ID" },
  { label: "System.Title", value: "[System.Title]", detail: "Title" },
  { label: "System.State", value: "[System.State]", detail: "State" },
  { label: "System.WorkItemType", value: "[System.WorkItemType]", detail: "Type" },
  { label: "System.AssignedTo", value: "[System.AssignedTo]", detail: "Assignee" },
  { label: "System.ChangedDate", value: "[System.ChangedDate]", detail: "Changed date" },
  { label: "System.CreatedDate", value: "[System.CreatedDate]", detail: "Created date" },
  { label: "System.TeamProject", value: "[System.TeamProject]", detail: "Project" },
  { label: "System.Tags", value: "[System.Tags]", detail: "Tags" },
  { label: "Microsoft.VSTS.Common.Priority", value: "[Microsoft.VSTS.Common.Priority]", detail: "Priority" },
  { label: "Microsoft.VSTS.Common.Severity", value: "[Microsoft.VSTS.Common.Severity]", detail: "Severity" },
  { label: "@Me", value: "@Me", detail: "Current user" },
  { label: "@Today", value: "@Today", detail: "Today" },
  { label: "@CurrentIteration", value: "@CurrentIteration", detail: "Current iteration" },
  { label: "@Follows", value: "@Follows", detail: "Followed work items" },
  { label: "SELECT", value: "SELECT ", detail: "Projection" },
  { label: "FROM WorkItems", value: "FROM WorkItems", detail: "Work Item source" },
  { label: "WHERE", value: "WHERE ", detail: "Filter" },
  { label: "ORDER BY", value: "ORDER BY ", detail: "Sort" },
  { label: "CONTAINS WORDS", value: "CONTAINS WORDS ", detail: "Text contains" },
];

function firstCustomView(views: WorkItemQueryView[]): WorkItemQueryView | null {
  return views.find((view) => !view.id.startsWith("builtin-")) ?? null;
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

function validateWiql(value: string): { errors: string[]; warnings: string[] } {
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!normalized.startsWith("select ")) {
    errors.push("WIQL must start with SELECT.");
  }
  if (!/\bfrom\s+(workitems|workitemlinks)\b/.test(normalized)) {
    errors.push("WIQL must include FROM WorkItems or FROM WorkItemLinks.");
  }
  if (!/\bwhere\b/.test(normalized)) {
    warnings.push("Add a WHERE clause to avoid broad queries.");
  }
  if (!/\border\s+by\b/.test(normalized)) {
    warnings.push("Add ORDER BY for stable result ordering.");
  }
  return { errors, warnings };
}

function wiqlTokenRange(value: string, cursor: number): { start: number; end: number; token: string } {
  const before = value.slice(0, cursor);
  const after = value.slice(cursor);
  const startMatch = /(?:^|[\s,=<>()[\]])([@\w.]*)$/.exec(before);
  const endMatch = /^([@\w.]*)/.exec(after);
  const token = `${startMatch?.[1] ?? ""}${endMatch?.[1] ?? ""}`;
  return {
    start: cursor - (startMatch?.[1]?.length ?? 0),
    end: cursor + (endMatch?.[1]?.length ?? 0),
    token,
  };
}

function wiqlCompletionMatches(
  value: string,
  cursor: number,
  pool: WiqlCompletion[],
): WiqlCompletion[] {
  const token = wiqlTokenRange(value, cursor).token.toLowerCase();
  const normalizedToken = token.replace(/^\[/, "");
  return pool.filter((completion) => {
    const haystack = `${completion.label} ${completion.value} ${completion.detail}`.toLowerCase();
    return !normalizedToken || haystack.includes(normalizedToken);
  }).slice(0, 8);
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

type WorkItemViewsPanelProps = {
  organizations: Organization[];
  selectedViewRequestId?: string | null;
  onSelectedViewChange?: (viewId: string | null) => void;
  onSelectedViewRequestHandled?: () => void;
  onViewsChange?: (views: WorkItemQueryView[]) => void;
};

function viewExportFileName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `azdodeck-work-item-views-${stamp}.json`;
}

function viewCardColumnCount(container: HTMLElement): number {
  const styles = window.getComputedStyle(container);
  const templateColumns = styles.gridTemplateColumns;
  if (templateColumns && templateColumns !== "none" && !templateColumns.includes("repeat(")) {
    const columns = templateColumns.split(/\s+/).filter(Boolean).length;
    if (columns > 0) return columns;
  }

  const columnGap = Number.parseFloat(styles.columnGap) || 0;
  const minCardWidth = 180;
  const width = container.clientWidth;
  if (width > 0) {
    return Math.max(1, Math.floor((width + columnGap) / (minCardWidth + columnGap)));
  }

  return 1;
}

export function WorkItemViewsPanel({
  organizations,
  selectedViewRequestId,
  onSelectedViewChange,
  onSelectedViewRequestHandled,
  onViewsChange,
}: WorkItemViewsPanelProps) {
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
  const [draftRefreshInterval, setDraftRefreshInterval] = useState(
    initialSelectedView?.refreshIntervalSec ? String(initialSelectedView.refreshIntervalSec) : "",
  );
  const [draftAlertThreshold, setDraftAlertThreshold] = useState(
    initialSelectedView?.alertThreshold !== undefined ? String(initialSelectedView.alertThreshold) : "",
  );
  const [draftExtraColumns, setDraftExtraColumns] = useState<string[]>(
    initialSelectedView?.extraColumns ?? [],
  );
  const draftNameRef = useRef(draftName);
  const draftProjectIdRef = useRef(draftProjectId);
  const draftWiqlRef = useRef(draftWiql);
  const draftLimitRef = useRef(draftLimit);
  const draftRefreshIntervalRef = useRef(draftRefreshInterval);
  const draftAlertThresholdRef = useRef(draftAlertThreshold);
  const draftExtraColumnsRef = useRef(draftExtraColumns);
  const draftWiqlTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [wiqlCursor, setWiqlCursor] = useState(draftWiql.length);
  const [wiqlCompletionsOpen, setWiqlCompletionsOpen] = useState(false);
  const [draftUrl, setDraftUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewMessage, setViewMessage] = useState<string | null>(null);
  const viewButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const restoreViewFocusIndexRef = useRef<number | null>(null);
  const viewFormRef = useRef<HTMLFormElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const selectedOrganizationId = organizationId || organizations[0]?.id || "";
  const projectsQuery = useQuery({
    queryKey: workItemQueryKeys.projects(selectedOrganizationId),
    queryFn: () => listWorkItemProjects({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
    staleTime: 5 * 60_000,
  });
  const projectOptions = projectsQuery.data ?? [];
  const wiqlValidation = useMemo(() => validateWiql(draftWiql), [draftWiql]);
  const fieldsQuery = useQuery({
    queryKey: workItemQueryKeys.fields(selectedOrganizationId, draftProjectId || null),
    queryFn: () =>
      listWorkItemFields({
        organizationId: selectedOrganizationId,
        projectId: draftProjectId,
      }),
    enabled: dialogOpen && !!selectedOrganizationId && !!draftProjectId,
    staleTime: 5 * 60_000,
  });
  const wiqlCompletionPool = useMemo(() => {
    const known = new Set(WIQL_COMPLETIONS.map((completion) => completion.value.toLowerCase()));
    const dynamic = (fieldsQuery.data ?? [])
      .filter((field) => !known.has(`[${field.referenceName.toLowerCase()}]`))
      .map((field) => ({
        label: field.referenceName,
        value: `[${field.referenceName}]`,
        detail: field.name,
      }));
    return [...WIQL_COMPLETIONS, ...dynamic];
  }, [fieldsQuery.data]);
  const wiqlCompletions = useMemo(
    () => wiqlCompletionMatches(draftWiql, wiqlCursor, wiqlCompletionPool),
    [draftWiql, wiqlCursor, wiqlCompletionPool],
  );

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
    saveWorkItemQueryViews(views);
    onViewsChange?.(views);
  }, [onViewsChange, views]);

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
      setWiqlCursor(data.wiql.length);
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
      refetchInterval: view.refreshIntervalSec ? view.refreshIntervalSec * 1000 : (false as const),
    })),
  });

  const viewCountsSignature = views
    .map((view, index) => `${view.id}:${viewCountQueries[index]?.data ?? ""}`)
    .join("|");
  useEffect(() => {
    const ids = views.map((view) => view.id);
    views.forEach((view, index) => {
      const count = viewCountQueries[index]?.data;
      if (typeof count === "number") recordViewCount(view.id, count, ids);
    });
    // viewCountQueries is a fresh array each render; the signature captures the inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewCountsSignature]);

  const selectedViewIndex = Math.max(
    0,
    views.findIndex((view) => view.id === selectedViewId),
  );
  const selectedView = views[selectedViewIndex] ?? null;
  const selectedViewProjectId = selectedView?.projectId || projectOptions[0]?.projectId || "";
  const selectedViewExtraColumns = selectedView?.extraColumns ?? [];
  const selectedQuery = useQuery({
    queryKey: workItemQueryKeys.queryView({
      organizationId: selectedOrganizationId,
      viewId: selectedView?.id,
      projectId: selectedViewProjectId,
      wiql: selectedView?.wiql,
      limit: selectedView?.limit,
      extraFieldsSignature: selectedViewExtraColumns.join("|"),
    }),
    queryFn: () =>
      runWorkItemQuery({
        organizationId: selectedOrganizationId,
        projectId: selectedViewProjectId,
        wiql: selectedView!.wiql,
        limit: selectedView!.limit,
        extraFields: selectedViewExtraColumns,
      }),
    enabled:
      !!selectedView &&
      !!selectedOrganizationId &&
      !!selectedViewProjectId &&
      !!selectedView.wiql.trim(),
    staleTime: 5 * 60_000,
    refetchInterval: selectedView?.refreshIntervalSec
      ? selectedView.refreshIntervalSec * 1000
      : false,
  });
  const selectedResults = selectedQuery?.data ?? [];
  const selectedQueryInitialLoading =
    !!selectedQuery && selectedQuery.isFetching && selectedQuery.data === undefined;

  useEffect(() => {
    onSelectedViewChange?.(selectedView?.id ?? null);
  }, [onSelectedViewChange, selectedView?.id]);

  useEffect(() => {
    const index = restoreViewFocusIndexRef.current;
    if (index === null) return;
    restoreViewFocusIndexRef.current = null;
    window.setTimeout(() => viewButtonRefs.current[index]?.focus(), 0);
  }, [selectedViewId]);

  useEffect(() => {
    if (!selectedViewRequestId) return;
    const requestedView = views.find((view) => view.id === selectedViewRequestId);
    if (!requestedView) {
      onSelectedViewRequestHandled?.();
      return;
    }
    setSelectedViewId(requestedView.id);
    loadDraft(requestedView);
    onSelectedViewRequestHandled?.();
  }, [onSelectedViewRequestHandled, selectedViewRequestId, views]);

  function loadDraft(view: WorkItemQueryView) {
    setEditingViewId(view.id);
    setDraftName(view.name);
    draftNameRef.current = view.name;
    setDraftProjectId(view.projectId);
    draftProjectIdRef.current = view.projectId;
    setDraftWiql(view.wiql);
    draftWiqlRef.current = view.wiql;
    setWiqlCursor(view.wiql.length);
    setDraftLimit(String(view.limit));
    draftLimitRef.current = String(view.limit);
    const refreshInterval = view.refreshIntervalSec ? String(view.refreshIntervalSec) : "";
    setDraftRefreshInterval(refreshInterval);
    draftRefreshIntervalRef.current = refreshInterval;
    const alertThreshold = view.alertThreshold !== undefined ? String(view.alertThreshold) : "";
    setDraftAlertThreshold(alertThreshold);
    draftAlertThresholdRef.current = alertThreshold;
    const extraColumns = view.extraColumns ?? [];
    setDraftExtraColumns(extraColumns);
    draftExtraColumnsRef.current = extraColumns;
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
    setWiqlCursor(defaultWiql.length);
    setDraftLimit("200");
    draftLimitRef.current = "200";
    setDraftRefreshInterval("");
    draftRefreshIntervalRef.current = "";
    setDraftAlertThreshold("");
    draftAlertThresholdRef.current = "";
    setDraftExtraColumns([]);
    draftExtraColumnsRef.current = [];
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
    const validation = validateWiql(wiql);
    if (validation.errors.length > 0) {
      setFormError(validation.errors[0]);
      return;
    }
    if (!Number.isFinite(Number(limitInput))) {
      setFormError("Limit must be a number.");
      return;
    }
    const refreshIntervalInput = draftRefreshIntervalRef.current.trim();
    if (refreshIntervalInput && !Number.isFinite(Number(refreshIntervalInput))) {
      setFormError("Auto refresh must be a number of seconds.");
      return;
    }
    const refreshIntervalSec = refreshIntervalInput
      ? clamp(
          Math.round(Number(refreshIntervalInput)),
          MIN_VIEW_REFRESH_INTERVAL_SEC,
          MAX_VIEW_REFRESH_INTERVAL_SEC,
        )
      : undefined;
    const alertThresholdInput = draftAlertThresholdRef.current.trim();
    if (alertThresholdInput && !Number.isFinite(Number(alertThresholdInput))) {
      setFormError("Alert threshold must be a number.");
      return;
    }
    const alertThreshold = alertThresholdInput
      ? Math.max(0, Math.round(Number(alertThresholdInput)))
      : undefined;

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
      refreshIntervalSec,
      alertThreshold,
      extraColumns: draftExtraColumnsRef.current,
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

  function updateDraftWiql(value: string, cursor?: number) {
    setDraftWiql(value);
    draftWiqlRef.current = value;
    if (typeof cursor === "number") setWiqlCursor(cursor);
  }

  function insertWiqlText(value: string) {
    const textarea = draftWiqlTextareaRef.current;
    const cursor = textarea?.selectionStart ?? wiqlCursor;
    const next = `${draftWiql.slice(0, cursor)}${draftWiql.slice(0, cursor).endsWith(" ") || value.startsWith(" ") || cursor === 0 ? "" : " "}${value}${draftWiql.slice(cursor)}`;
    const nextCursor = cursor + value.length + (draftWiql.slice(0, cursor).endsWith(" ") || value.startsWith(" ") || cursor === 0 ? 0 : 1);
    updateDraftWiql(next, nextCursor);
    window.setTimeout(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCursor, nextCursor);
    }, 0);
  }

  function applyWiqlCompletion(completion: WiqlCompletion) {
    const range = wiqlTokenRange(draftWiql, wiqlCursor);
    const prefix = draftWiql.slice(0, range.start);
    const suffix = draftWiql.slice(range.end);
    const separator = prefix && !/\s$/.test(prefix) && !completion.value.startsWith(" ") ? " " : "";
    const trailing = suffix && !/^\s/.test(suffix) && !completion.value.endsWith(" ") ? " " : "";
    const next = `${prefix}${separator}${completion.value}${trailing}${suffix}`;
    const nextCursor = prefix.length + separator.length + completion.value.length + trailing.length;
    updateDraftWiql(next, nextCursor);
    setWiqlCompletionsOpen(false);
    window.setTimeout(() => {
      draftWiqlTextareaRef.current?.focus();
      draftWiqlTextareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    }, 0);
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
    restoreViewFocusIndexRef.current = nextIndex;
    setSelectedViewId(view.id);
    loadDraft(view);
    viewButtonRefs.current[nextIndex]?.focus();
  }

  function handleViewListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (isEditableTarget(event.target) || views.length === 0) return;
    // Shift is part of the reorder chords below, but Ctrl/Meta/Alt chords
    // belong to app-level shortcuts (Ctrl+K, Ctrl+R, …).
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const columnCount = viewCardColumnCount(event.currentTarget);
    if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowUp")) {
      event.preventDefault();
      moveSelectedView(-1);
    } else if (event.shiftKey && (event.key === "ArrowRight" || event.key === "ArrowDown")) {
      event.preventDefault();
      moveSelectedView(1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      selectViewAt(selectedViewIndex + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectViewAt(selectedViewIndex - 1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      selectViewAt(selectedViewIndex + columnCount);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selectViewAt(selectedViewIndex - columnCount);
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
      runViews();
    }
  }

  const runViews = () => {
    invalidateWorkItemQueryViews(queryClient, selectedOrganizationId);
  };

  async function copySelectedViewShareJson() {
    if (!selectedView) return;
    const text = JSON.stringify(createWorkItemQueryViewsExport([selectedView]), null, 2);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API is not available.");
      }
      await navigator.clipboard.writeText(text);
      setViewMessage("Copied selected view share JSON.");
    } catch (error) {
      setViewMessage(error instanceof Error ? error.message : "Failed to copy share JSON.");
    }
  }

  function exportAllViews() {
    const text = JSON.stringify(createWorkItemQueryViewsExport(views), null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = viewExportFileName();
    link.click();
    URL.revokeObjectURL(url);
    setViewMessage(`Exported ${views.length} view${views.length === 1 ? "" : "s"}.`);
  }

  async function importViewsFromFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const imported = parseWorkItemQueryViewsImport(await file.text()).map((view) => ({
        ...view,
        id: newWorkItemViewId(),
      }));
      setViews((current) => [...current, ...imported]);
      const firstImported = imported[0];
      setSelectedViewId(firstImported.id);
      loadDraft(firstImported);
      setViewMessage(`Imported ${imported.length} view${imported.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setViewMessage(error instanceof Error ? error.message : "Failed to import views.");
    }
  }

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
              onClick={() => void copySelectedViewShareJson()}
              aria-label="Copy selected view share JSON"
              title="Copy selected view share JSON"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              Share
            </button>
            <button
              type="button"
              disabled={views.length === 0}
              onClick={exportAllViews}
              title="Export all views as JSON"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              title="Import views from JSON"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              Import
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => void importViewsFromFile(event)}
            />
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
              onClick={runViews}
              title="Run all views (R)"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
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
        {viewMessage ? (
          <div role="status" className="border-b border-border px-3 py-1 text-xs text-muted-foreground">
            {viewMessage}
          </div>
        ) : null}

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
              const overflow = typeof query?.data === "number" && query.data > view.limit;
              const displayCount = overflow ? `${view.limit}+` : count;
              const baseline = viewCountBaseline(view.id);
              const delta =
                typeof query?.data === "number" && baseline !== null
                  ? query.data - baseline
                  : null;
              const alerting =
                typeof view.alertThreshold === "number" &&
                typeof query?.data === "number" &&
                query.data >= view.alertThreshold;
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
                  className={`min-h-[88px] rounded-md border p-3 text-left outline-none transition-colors focus:ring-2 focus:ring-inset focus:ring-ring ${
                    alerting
                      ? selected
                        ? "border-destructive bg-secondary"
                        : "border-destructive bg-destructive/5 hover:bg-destructive/10"
                      : selected
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
                  <div className="mt-3 flex items-baseline gap-1.5">
                    <span
                      className={`text-3xl font-semibold leading-none ${
                        alerting ? "text-destructive" : ""
                      }`}
                    >
                      {query?.isError ? "!" : displayCount}
                    </span>
                    {delta !== null && delta !== 0 && !query?.isError ? (
                      <span
                        className="text-xs font-medium text-muted-foreground"
                        title="Change since the previous session"
                      >
                        {delta > 0 ? `+${delta}` : delta}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {query?.isError
                      ? commandErrorMessage(query.error)
                      : `${view.limit} max results`}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground/80">
                    {(view.sortKey ?? "changedDate")} {(view.sortDirection ?? "desc").toUpperCase()}
                    {view.previewVisible === false ? " · preview off" : ""}
                    {view.refreshIntervalSec ? ` · auto ${view.refreshIntervalSec}s` : ""}
                    {view.alertThreshold !== undefined ? ` · alert ≥${view.alertThreshold}` : ""}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selectedView && !dialogOpen ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {selectedQuery?.isError ? (
            <ErrorState message={commandErrorMessage(selectedQuery.error)} />
          ) : null}

          <WorkItemsGrid
            key={selectedView.id}
            dataUpdatedAt={selectedQuery?.dataUpdatedAt}
            loading={selectedQueryInitialLoading}
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
            extraColumns={selectedViewExtraColumns}
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

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Auto refresh (sec)
                    <span className="ml-1 font-normal text-muted-foreground/70">(empty = off)</span>
                  </span>
                  <input
                    type="number"
                    min={MIN_VIEW_REFRESH_INTERVAL_SEC}
                    max={MAX_VIEW_REFRESH_INTERVAL_SEC}
                    placeholder="off"
                    value={draftRefreshInterval}
                    onChange={(event) => {
                      setDraftRefreshInterval(event.target.value);
                      draftRefreshIntervalRef.current = event.target.value;
                    }}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>

                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Alert when count ≥
                    <span className="ml-1 font-normal text-muted-foreground/70">(empty = off)</span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    placeholder="off"
                    value={draftAlertThreshold}
                    onChange={(event) => {
                      setDraftAlertThreshold(event.target.value);
                      draftAlertThresholdRef.current = event.target.value;
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
                        onClick={() => insertWiqlText(macro)}
                        className="rounded border border-border bg-white px-1.5 py-0.5 font-mono text-[10px] hover:bg-secondary"
                      >
                        {macro}
                      </button>
                    ))}
                  </span>
                </div>
                <textarea
                  ref={draftWiqlTextareaRef}
                  id="view-wiql-input"
                  value={draftWiql}
                  onChange={(event) => {
                    updateDraftWiql(event.target.value, event.target.selectionStart);
                    setWiqlCompletionsOpen(true);
                  }}
                  onClick={(event) => setWiqlCursor(event.currentTarget.selectionStart)}
                  onKeyUp={(event) => setWiqlCursor(event.currentTarget.selectionStart)}
                  onFocus={(event) => {
                    setWiqlCursor(event.currentTarget.selectionStart);
                    setWiqlCompletionsOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.ctrlKey && event.key === " ") {
                      event.preventDefault();
                      setWiqlCompletionsOpen((open) => !open);
                    }
                    if (event.key === "Escape" && wiqlCompletionsOpen) {
                      event.stopPropagation();
                      setWiqlCompletionsOpen(false);
                    }
                  }}
                  rows={7}
                  spellCheck={false}
                  className="min-h-[120px] resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-5 outline-none focus:ring-2 focus:ring-ring"
                />
                {wiqlCompletionsOpen && wiqlCompletions.length > 0 ? (
                  <div className="flex max-h-24 flex-wrap gap-1 overflow-auto rounded-md border border-border bg-slate-50 p-1.5">
                    {wiqlCompletions.map((completion) => (
                      <button
                        key={`${completion.label}:${completion.value}`}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applyWiqlCompletion(completion)}
                        className="rounded border border-border bg-white px-1.5 py-0.5 text-left text-[11px] hover:bg-secondary"
                        title={completion.detail}
                      >
                        <span className="font-mono">{completion.label}</span>
                        <span className="ml-1 text-muted-foreground">{completion.detail}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {wiqlValidation.errors.length > 0 || wiqlValidation.warnings.length > 0 ? (
                  <div className="space-y-0.5 text-xs">
                    {wiqlValidation.errors.map((error) => (
                      <p key={error} className="text-destructive">{error}</p>
                    ))}
                    {wiqlValidation.warnings.map((warning) => (
                      <p key={warning} className="text-amber-700">{warning}</p>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Extra columns
                  <span className="ml-1 font-normal text-muted-foreground/70">
                    (shown after the standard columns)
                  </span>
                </span>
                {draftExtraColumns.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {draftExtraColumns.map((referenceName) => (
                      <span
                        key={referenceName}
                        className="inline-flex items-center gap-1 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[11px]"
                        title={referenceName}
                      >
                        {referenceName}
                        <button
                          type="button"
                          aria-label={`Remove column ${referenceName}`}
                          onClick={() => {
                            const next = draftExtraColumns.filter((c) => c !== referenceName);
                            setDraftExtraColumns(next);
                            draftExtraColumnsRef.current = next;
                          }}
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <select
                  value=""
                  aria-label="Add extra column"
                  disabled={fieldsQuery.isLoading}
                  onChange={(event) => {
                    const referenceName = event.target.value;
                    if (!referenceName) return;
                    const next = normalizeViewExtraColumns([...draftExtraColumns, referenceName]);
                    setDraftExtraColumns(next);
                    draftExtraColumnsRef.current = next;
                  }}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                >
                  <option value="">Add column…</option>
                  {(fieldsQuery.data ?? [])
                    .filter(
                      (field) =>
                        !draftExtraColumns.some(
                          (existing) =>
                            existing.toLowerCase() === field.referenceName.toLowerCase(),
                        ),
                    )
                    .map((field) => (
                      <option key={field.referenceName} value={field.referenceName}>
                        {field.name} ({field.referenceName})
                      </option>
                    ))}
                </select>
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
