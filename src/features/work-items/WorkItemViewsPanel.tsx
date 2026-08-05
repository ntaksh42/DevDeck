import {
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import {
  listWorkItemProjects,
  runWorkItemQuery,
  commandErrorMessage,
} from '@/lib/azdoCommands';
import { useActiveOrganizationId } from '@/lib/useActiveConnection';
import { clamp, handleSearchInputEscape, isEditableTarget } from '@/lib/utils';
import { matchesWorkItemQuery, parseSearchQuery } from '@/lib/searchQuery';
import { ErrorState } from '@/components/StateDisplay';
import { WorkItemsGrid } from './WorkItemsGrid';
import { WorkItemBoard } from './WorkItemBoard';
import { toMatchTarget } from './workItemMatchTarget';
import { invalidateWorkItemQueryViews, workItemQueryKeys } from './queryKeys';
import {
  loadWorkItemQueryViews,
  saveWorkItemQueryViews,
  loadWorkItemViewLayout,
  saveWorkItemViewLayout,
  type WorkItemQueryView,
  type WorkItemViewLayout,
} from './workItemViewsStorage';
import { firstCustomView, viewCardColumnCount } from './workItemViewsHelpers';
import {
  loadWorkItemViewsCardMode,
  loadWorkItemViewsCollapsed,
  saveWorkItemViewsCardMode,
  saveWorkItemViewsCollapsed,
  type WorkItemViewsCardMode,
} from './workItemViewsDisplayStorage';
import {
  copyViewShareJson,
  downloadViewsExport,
  readViewsImportFile,
} from './workItemViewsTransfer';
import { useViewCountQueries } from './useViewCountQueries';
import { useViewEditorDraft } from './useViewEditorDraft';
import { ViewEditorDialog } from './ViewEditorDialog';
import { ViewsListPanel } from './ViewsListPanel';

type WorkItemViewsPanelProps = {
  selectedViewRequestId?: string | null;
  onSelectedViewChange?: (viewId: string | null) => void;
  onSelectedViewRequestHandled?: () => void;
  onViewsChange?: (views: WorkItemQueryView[]) => void;
};

export function WorkItemViewsPanel({
  selectedViewRequestId,
  onSelectedViewChange,
  onSelectedViewRequestHandled,
  onViewsChange,
}: WorkItemViewsPanelProps) {
  const queryClient = useQueryClient();
  const selectedOrganizationId = useActiveOrganizationId();
  const [views, setViews] = useState<WorkItemQueryView[]>(() => loadWorkItemQueryViews());
  const initialSelectedView = firstCustomView(views);
  const [selectedViewId, setSelectedViewId] = useState<string | null>(initialSelectedView?.id ?? null);
  const [viewMessage, setViewMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [layout, setLayout] = useState<WorkItemViewLayout>(() =>
    initialSelectedView ? loadWorkItemViewLayout(initialSelectedView.id) : "list",
  );
  const [listCollapsed, setListCollapsed] = useState<boolean>(loadWorkItemViewsCollapsed);
  const [cardMode, setCardMode] = useState<WorkItemViewsCardMode>(loadWorkItemViewsCardMode);
  const viewButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const restoreViewFocusIndexRef = useRef<number | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const collapseToggleRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusAfterCollapseRef = useRef<"toggle" | "list" | null>(null);

  const projectsQuery = useQuery({
    queryKey: workItemQueryKeys.projects(selectedOrganizationId),
    queryFn: () => listWorkItemProjects({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
    staleTime: 5 * 60_000,
  });
  const projectOptions = projectsQuery.data ?? [];

  const draft = useViewEditorDraft({
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

  const viewCountQueries = useViewCountQueries({
    views,
    selectedOrganizationId,
    projectOptions,
  });

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
  const filteredResults = useMemo(() => {
    const parsed = parseSearchQuery(filter);
    if (parsed.filters.length === 0 && parsed.text.length === 0) return selectedResults;
    return selectedResults.filter((item) => matchesWorkItemQuery(toMatchTarget(item), parsed));
  }, [selectedResults, filter]);
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

  function toggleListCollapsed() {
    setListCollapsed((collapsed) => {
      const next = !collapsed;
      saveWorkItemViewsCollapsed(next);
      // Collapsing unmounts the list the keyboard was in, so hand focus to the
      // toggle rather than stranding it on <body>. Expanding returns focus to
      // the selected view so arrow navigation resumes where it left off.
      restoreFocusAfterCollapseRef.current = next ? "toggle" : "list";
      return next;
    });
  }

  function changeCardMode(next: WorkItemViewsCardMode) {
    setCardMode(next);
    saveWorkItemViewsCardMode(next);
  }

  useEffect(() => {
    const index = restoreViewFocusIndexRef.current;
    if (index === null) return;
    restoreViewFocusIndexRef.current = null;
    window.setTimeout(() => viewButtonRefs.current[index]?.focus(), 0);
  }, [selectedViewId]);

  useEffect(() => {
    const target = restoreFocusAfterCollapseRef.current;
    if (!target) return;
    restoreFocusAfterCollapseRef.current = null;
    window.setTimeout(() => {
      if (target === "toggle") {
        collapseToggleRef.current?.focus();
      } else {
        viewButtonRefs.current[selectedViewIndex]?.focus();
      }
    }, 0);
  }, [listCollapsed, selectedViewIndex]);

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
    // Ctrl+B is handled by the panel wrapper so it also works from the grid.
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
    setViewMessage(await copyViewShareJson(selectedView));
  }

  async function exportAllViews() {
    setViewMessage(await downloadViewsExport(views));
  }

  async function importViewsFromFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const result = await readViewsImportFile(file);
    if (result.status === "ok") {
      setViews((current) => [...current, ...result.views]);
      const firstImported = result.views[0];
      setSelectedViewId(firstImported.id);
      draft.loadDraft(firstImported);
    }
    setViewMessage(result.message);
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3"
      onKeyDown={(event) => {
        // Ctrl+B works from the grid too, so a collapsed list can always be
        // brought back without reaching for the mouse.
        if (
          (event.ctrlKey || event.metaKey) &&
          !event.altKey &&
          (event.key === "b" || event.key === "B")
        ) {
          event.preventDefault();
          toggleListCollapsed();
        }
      }}
    >
      <ViewsListPanel
        views={views}
        selectedView={selectedView}
        selectedViewIndex={selectedViewIndex}
        viewCountQueries={viewCountQueries}
        layout={layout}
        collapsed={listCollapsed}
        onCollapsedToggle={toggleListCollapsed}
        collapseToggleRef={collapseToggleRef}
        cardMode={cardMode}
        onCardModeChange={changeCardMode}
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
        onExport={() => void exportAllViews()}
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

          <div className="flex h-8 shrink-0 items-center rounded-md border border-input bg-background px-2 focus-within:ring-2 focus-within:ring-ring">
            <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => handleSearchInputEscape(event, () => setFilter(""))}
              placeholder="Filter… try #1234, p:1, @user, s:active, t:bug"
              aria-label="Filter"
              title="Smart search: #1234 jumps to an id, p:1–4 priority, @user assignee, s:active state, t:bug type. Unknown prefixes are searched as text."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>

          {layout === "board" ? (
            <WorkItemBoard
              key={`board-${selectedView.id}`}
              organizationId={selectedOrganizationId}
              projectId={selectedViewProjectId}
              results={filteredResults}
              autoFocus
            />
          ) : (
            <WorkItemsGrid
              key={selectedView.id}
              activeExternalFilterCount={filter.trim() ? 1 : 0}
              onClearExternalFilters={() => setFilter("")}
              dataUpdatedAt={selectedQuery?.dataUpdatedAt}
              isFetching={!!selectedQuery?.isFetching && selectedQuery.data !== undefined}
              loading={selectedQueryInitialLoading}
              results={filteredResults}
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
          draft={draft}
          projectOptions={projectOptions}
          projectsLoading={projectsQuery.isLoading}
          onClose={() => draft.setDialogOpen(false)}
        />
      ) : null}
    </div>
  );
}
