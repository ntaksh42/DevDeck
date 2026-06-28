import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getSavedQuery,
  listWorkItemFields,
  commandErrorMessage,
  type WorkItemProjectOption,
} from '@/lib/azdoCommands';
import { clamp } from '@/lib/utils';
import { workItemQueryKeys } from './queryKeys';
import {
  MAX_VIEW_REFRESH_INTERVAL_SEC,
  MIN_VIEW_REFRESH_INTERVAL_SEC,
  type WorkItemQueryView,
} from './workItemViewsStorage';
import {
  type WiqlCompletion,
  WIQL_COMPLETIONS,
  defaultWorkItemWiql,
  newWorkItemViewId,
  parseAzdoQueryUrl,
  validateWiql,
  wiqlCompletionMatches,
  wiqlTokenRange,
} from './workItemViewsHelpers';

type UseViewEditorDraftParams = {
  selectedOrganizationId: string;
  views: WorkItemQueryView[];
  setViews: React.Dispatch<React.SetStateAction<WorkItemQueryView[]>>;
  setSelectedViewId: React.Dispatch<React.SetStateAction<string | null>>;
  projectOptions: WorkItemProjectOption[];
  projectsLoading: boolean;
  initialSelectedView: WorkItemQueryView | null;
};

export type ViewEditorDraftReturn = ReturnType<typeof useViewEditorDraft>;

export function useViewEditorDraft({
  selectedOrganizationId,
  views,
  setViews,
  setSelectedViewId,
  projectOptions,
  projectsLoading,
  initialSelectedView,
}: UseViewEditorDraftParams) {
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
    const known = new Set(WIQL_COMPLETIONS.map((c) => c.value.toLowerCase()));
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
    queryKey: workItemQueryKeys.savedQuery(selectedOrganizationId, resolvedProjectId, urlQueryId),
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
    if (!draftProjectId && projectOptions[0]) {
      setDraftProjectId(projectOptions[0].projectId);
      draftProjectIdRef.current = projectOptions[0].projectId;
    }
  }, [draftProjectId, projectOptions]);

  useEffect(() => {
    if (!dialogOpen || !resolvedProjectId || !urlQueryId) return;
    setDraftProjectId(resolvedProjectId);
    draftProjectIdRef.current = resolvedProjectId;
  }, [resolvedProjectId, urlQueryId, dialogOpen]);

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
    const target = view ?? views.find((v) => v.id === editingViewId) ?? null;
    if (!target) return;
    loadDraft(target);
    setDialogOpen(true);
  }

  function handleUrlChange(url: string) {
    setDraftUrl(url);
  }

  const urlStatus: { text: string; severity: "success" | "error" | "info" } | null =
    (() => {
      if (!draftUrl.trim()) return null;
      const hasAzdoHost =
        draftUrl.includes("dev.azure.com") || draftUrl.includes(".visualstudio.com");
      if (!hasAzdoHost) return { text: "Enter an Azure DevOps URL.", severity: "info" };
      if (urlQueryId) {
        if (urlProjectName && !resolvedProjectId && !projectsLoading) {
          return { text: `Project "${urlProjectName}" not found.`, severity: "error" };
        }
        if (savedQueryFetch.isFetching) return { text: "Fetching WIQL…", severity: "info" };
        if (savedQueryFetch.isError) {
          return {
            text: `Fetch error: ${commandErrorMessage(savedQueryFetch.error)}`,
            severity: "error",
          };
        }
        if (savedQueryFetch.isSuccess && savedQueryFetch.data.wiql == null) {
          return {
            text: "No WIQL found at this URL (may be a folder or tree query).",
            severity: "error",
          };
        }
        if (savedQueryFetch.isSuccess) return { text: "WIQL fetched.", severity: "success" };
      } else if (urlParsed.orgName ?? urlParsed.projectName) {
        return { text: "Org / Project auto-filled. Enter WIQL manually.", severity: "info" };
      } else {
        return { text: "Azure DevOps query URL not recognized.", severity: "info" };
      }
      return null;
    })();

  function saveView(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draftNameRef.current.trim();
    const projectId = draftProjectIdRef.current;
    const wiql = draftWiqlRef.current.trim();
    const limitInput = draftLimitRef.current;
    const limit = clamp(Number(limitInput), 1, 500);
    if (!name) { setFormError("View name is required."); return; }
    if (!projectId) { setFormError("Project is required."); return; }
    if (!wiql) { setFormError("WIQL query is required."); return; }
    const validation = validateWiql(wiql);
    if (validation.errors.length > 0) { setFormError(validation.errors[0]); return; }
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
      pinned: views.find((v) => v.id === editingViewId)?.pinned ?? false,
      projectId,
      previewVisible: views.find((v) => v.id === editingViewId)?.previewVisible ?? true,
      sortDirection: views.find((v) => v.id === editingViewId)?.sortDirection ?? "desc",
      sortKey: views.find((v) => v.id === editingViewId)?.sortKey ?? "changedDate",
      wiql,
      limit,
      refreshIntervalSec,
      alertThreshold,
      extraColumns: draftExtraColumnsRef.current,
    };
    setViews((current) =>
      editingViewId && current.some((v) => v.id === editingViewId)
        ? current.map((v) => (v.id === editingViewId ? nextView : v))
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
    const next = `${draftWiql.slice(0, cursor)}${
      draftWiql.slice(0, cursor).endsWith(" ") || value.startsWith(" ") || cursor === 0 ? "" : " "
    }${value}${draftWiql.slice(cursor)}`;
    const nextCursor =
      cursor +
      value.length +
      (draftWiql.slice(0, cursor).endsWith(" ") || value.startsWith(" ") || cursor === 0 ? 0 : 1);
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
    const separator =
      prefix && !/\s$/.test(prefix) && !completion.value.startsWith(" ") ? " " : "";
    const trailing =
      suffix && !/^\s/.test(suffix) && !completion.value.endsWith(" ") ? " " : "";
    const next = `${prefix}${separator}${completion.value}${trailing}${suffix}`;
    const nextCursor = prefix.length + separator.length + completion.value.length + trailing.length;
    updateDraftWiql(next, nextCursor);
    setWiqlCompletionsOpen(false);
    window.setTimeout(() => {
      draftWiqlTextareaRef.current?.focus();
      draftWiqlTextareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    }, 0);
  }

  const handleNameChange = (v: string) => { setDraftName(v); draftNameRef.current = v; };
  const handleProjectChange = (v: string) => { setDraftProjectId(v); draftProjectIdRef.current = v; };
  const handleLimitChange = (v: string) => { setDraftLimit(v); draftLimitRef.current = v; };
  const handleRefreshIntervalChange = (v: string) => { setDraftRefreshInterval(v); draftRefreshIntervalRef.current = v; };
  const handleAlertThresholdChange = (v: string) => { setDraftAlertThreshold(v); draftAlertThresholdRef.current = v; };
  const handleExtraColumnsChange = (cols: string[]) => { setDraftExtraColumns(cols); draftExtraColumnsRef.current = cols; };

  return {
    // Dialog open state
    dialogOpen,
    setDialogOpen,
    openAddDialog,
    openEditDialog,
    // Editing identity
    editingViewId,
    // Draft field values
    draftUrl,
    draftName,
    draftProjectId,
    draftWiql,
    draftLimit,
    draftRefreshInterval,
    draftAlertThreshold,
    draftExtraColumns,
    wiqlCursor,
    wiqlCompletionsOpen,
    formError,
    // Computed display values
    urlStatus,
    wiqlValidation,
    wiqlCompletions,
    // Field data for extra columns
    fields: fieldsQuery.data ?? [],
    fieldsLoading: fieldsQuery.isLoading,
    // Refs
    draftWiqlTextareaRef,
    // Change handlers
    onUrlChange: handleUrlChange,
    onNameChange: handleNameChange,
    onProjectChange: handleProjectChange,
    onLimitChange: handleLimitChange,
    onRefreshIntervalChange: handleRefreshIntervalChange,
    onAlertThresholdChange: handleAlertThresholdChange,
    onExtraColumnsChange: handleExtraColumnsChange,
    setWiqlCursor,
    setWiqlCompletionsOpen,
    updateDraftWiql,
    insertWiqlText,
    applyWiqlCompletion,
    // Form submit
    saveView,
    // Draft loaders (called from parent)
    loadDraft,
    resetDraft,
  };
}
