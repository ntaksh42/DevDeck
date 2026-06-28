import {
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  countWorkItemQuery,
  listWorkItemProjects,
  runWorkItemQuery,
  commandErrorMessage,
  type Organization,
} from '@/lib/azdoCommands';
import { clamp, isEditableTarget } from '@/lib/utils';
import { ErrorState } from '@/components/StateDisplay';
import { WorkItemsGrid } from './WorkItemsGrid';
import { WorkItemBoard } from './WorkItemBoard';
import { invalidateWorkItemQueryViews, workItemQueryKeys } from './queryKeys';
import {
  createWorkItemQueryViewsExport,
  loadWorkItemQueryViews,
  parseWorkItemQueryViewsImport,
  recordViewCount,
  saveWorkItemQueryViews,
  loadWorkItemViewLayout,
  saveWorkItemViewLayout,
  type WorkItemQueryView,
  type WorkItemViewLayout,
} from './workItemViewsStorage';
import {
  firstCustomView,
  newWorkItemViewId,
  viewExportFileName,
  viewCardColumnCount,
} from './workItemViewsHelpers';
import { useViewEditorDraft } from './useViewEditorDraft';
import { ViewEditorDialog } from './ViewEditorDialog';
import { ViewsListPanel } from './ViewsListPanel';

type WorkItemViewsPanelProps = {
  organizations: Organization[];
  selectedViewRequestId?: string | null;
  onSelectedViewChange?: (viewId: string | null) => void;
  onSelectedViewRequestHandled?: () => void;
  onViewsChange?: (views: WorkItemQueryView[]) => void;
};

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
  const [viewMessage, setViewMessage] = useState<string | null>(null);
  const [layout, setLayout] = useState<WorkItemViewLayout>(() =>
    initialSelectedView ? loadWorkItemViewLayout(initialSelectedView.id) : "list",
  );
  const viewButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const restoreViewFocusIndexRef = useRef<number | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const selectedOrganizationId = organizationId || organizations[0]?.id || "";
  const projectsQuery = useQuery({
    queryKey: workItemQueryKeys.projects(selectedOrganizationId),
    queryFn: () => listWorkItemProjects({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
    staleTime: 5 * 60_000,
  });
  const projectOptions = projectsQuery.data ?? [];

  const draft = useViewEditorDraft({
    organizations,
    organizationId,
    setOrganizationId,
    selectedOrganizationId,
    views,
    setViews,
    setSelectedViewId,
    projectOptions,
    projectsLoading: projectsQuery.isLoading,
    initialSelectedView,
  });

  useEffect(() => {
    saveWorkItemQueryViews(views);
    onViewsChange?.(views);
  }, [onViewsChange, views]);

  useEffect(() => {
    if (selectedViewId && views.some((view) => view.id === selectedViewId)) return;
    const next = firstCustomView(views);
    setSelectedViewId(next?.id ?? null);
    if (next) {
      draft.loadDraft(next);
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
    setLayout(selectedView ? loadWorkItemViewLayout(selectedView.id) : "list");
  }, [selectedView?.id]);

  function changeLayout(next: WorkItemViewLayout) {
    setLayout(next);
    if (selectedView) saveWorkItemViewLayout(selectedView.id, next);
  }

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
    draft.loadDraft(requestedView);
    onSelectedViewRequestHandled?.();
  }, [onSelectedViewRequestHandled, selectedViewRequestId, views]);

  function deleteSelectedView() {
    if (!selectedView) return;
    setViews((current) => current.filter((view) => view.id !== selectedView.id));
    draft.resetDraft();
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
    draft.loadDraft(view);
    viewButtonRefs.current[nextIndex]?.focus();
  }

  function handleViewListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (isEditableTarget(event.target) || views.length === 0) return;
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
      draft.openAddDialog();
    } else if (event.key === "e" || event.key === "E") {
      event.preventDefault();
      draft.openEditDialog();
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
      draft.loadDraft(firstImported);
      setViewMessage(`Imported ${imported.length} view${imported.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setViewMessage(error instanceof Error ? error.message : "Failed to import views.");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ViewsListPanel
        views={views}
        selectedView={selectedView}
        selectedViewIndex={selectedViewIndex}
        viewCountQueries={viewCountQueries}
        layout={layout}
        viewMessage={viewMessage}
        viewButtonRefs={viewButtonRefs}
        importInputRef={importInputRef}
        onLayoutChange={changeLayout}
        onPinToggle={toggleSelectedViewPinned}
        onMoveLeft={() => moveSelectedView(-1)}
        onMoveRight={() => moveSelectedView(1)}
        onPreviewToggle={() =>
          updateSelectedView({ previewVisible: selectedView?.previewVisible === false })
        }
        onShare={() => void copySelectedViewShareJson()}
        onExport={exportAllViews}
        onImport={(e) => void importViewsFromFile(e)}
        onEditOpen={() => draft.openEditDialog()}
        onDelete={deleteSelectedView}
        onRun={runViews}
        onAddOpen={draft.openAddDialog}
        onSelectView={(view) => {
          setSelectedViewId(view.id);
          draft.loadDraft(view);
        }}
        onEditView={(view) => draft.openEditDialog(view)}
        onKeyDown={handleViewListKeyDown}
      />

      {selectedView && !draft.dialogOpen ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {selectedQuery?.isError ? (
            <ErrorState
              message={commandErrorMessage(selectedQuery.error)}
              onRetry={() => void selectedQuery.refetch()}
            />
          ) : null}

          {layout === "board" ? (
            <WorkItemBoard
              key={`board-${selectedView.id}`}
              organizationId={selectedOrganizationId}
              projectId={selectedViewProjectId}
              results={selectedResults}
              autoFocus
            />
          ) : (
            <WorkItemsGrid
              key={selectedView.id}
              dataUpdatedAt={selectedQuery?.dataUpdatedAt}
              isFetching={!!selectedQuery?.isFetching && selectedQuery.data !== undefined}
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
          )}
        </div>
      ) : null}

      {draft.dialogOpen ? (
        <ViewEditorDialog
          editingViewId={draft.editingViewId}
          organizations={organizations}
          organizationId={selectedOrganizationId}
          onOrganizationChange={draft.onOrganizationChange}
          draftUrl={draft.draftUrl}
          onUrlChange={draft.onUrlChange}
          urlStatus={draft.urlStatus}
          draftName={draft.draftName}
          onNameChange={draft.onNameChange}
          draftProjectId={draft.draftProjectId}
          onProjectChange={draft.onProjectChange}
          projectOptions={projectOptions}
          projectsLoading={projectsQuery.isLoading}
          draftLimit={draft.draftLimit}
          onLimitChange={draft.onLimitChange}
          draftRefreshInterval={draft.draftRefreshInterval}
          onRefreshIntervalChange={draft.onRefreshIntervalChange}
          draftAlertThreshold={draft.draftAlertThreshold}
          onAlertThresholdChange={draft.onAlertThresholdChange}
          draftWiql={draft.draftWiql}
          updateDraftWiql={draft.updateDraftWiql}
          draftWiqlTextareaRef={draft.draftWiqlTextareaRef}
          wiqlCursor={draft.wiqlCursor}
          setWiqlCursor={draft.setWiqlCursor}
          wiqlCompletionsOpen={draft.wiqlCompletionsOpen}
          setWiqlCompletionsOpen={draft.setWiqlCompletionsOpen}
          wiqlCompletions={draft.wiqlCompletions}
          onApplyCompletion={draft.applyWiqlCompletion}
          onInsertWiqlText={draft.insertWiqlText}
          wiqlValidation={draft.wiqlValidation}
          draftExtraColumns={draft.draftExtraColumns}
          onExtraColumnsChange={draft.onExtraColumnsChange}
          fields={draft.fields}
          fieldsLoading={draft.fieldsLoading}
          formError={draft.formError}
          onSave={draft.saveView}
          onClose={() => draft.setDialogOpen(false)}
        />
      ) : null}
    </div>
  );
}
