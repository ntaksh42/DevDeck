import { useState } from 'react';
import { commandErrorMessage } from '@/lib/azdoCommands';
import { CreateWorkItemDialog, type CreateWorkItemDraft } from './CreateWorkItemDialog';
import { SnoozeMenu } from '@/components/SnoozeMenu';
import { SnoozedItemsPanel } from '@/components/SnoozedItemsPanel';
import { DockableWorkspace, type DockablePanelSpec } from '@/components/DockableWorkspace';
import { ColumnVisibilityMenu } from '@/components/ColumnVisibilityMenu';
import { PreviewEmptyState } from '@/components/StateDisplay';
import { WorkItemPreviewPanel } from './WorkItemPreviewPanel';
import { WorkItemResultSection } from './WorkItemResultSection';
import { storeCustomPreviewFields } from './previewFieldsStorage';
import { workItemQueryKeys } from './queryKeys';
import {
  DEFAULT_WORK_ITEM_PREVIEW_WIDTH,
  MAX_WORK_ITEM_PREVIEW_WIDTH,
  WORK_ITEM_PREVIEW_WIDTH_STORAGE_KEY,
  WI_GRID_KEYS,
  WI_GRID_REQUIRED_COLUMNS,
  wiSortLabels,
  type WiSortState,
} from './workItemsGridHelpers';
import { BulkActionBar, BulkFailurePanel } from './BulkActionBar';
import { WiGridHeader } from './WiGridHeader';
import { WiGridBody } from './WiGridBody';
import { WiGridStatusBar } from './WiGridStatusBar';
import { WiColumnFilterDropdown } from './WiColumnFilterDropdown';
import { useWiGridState } from './useWiGridState';
import { useWiGridLogic } from './useWiGridLogic';
import type { WorkItemSummary } from '@/lib/azdoCommands';

// Re-export so existing importers (e.g. bulkSelectionSummary.test.ts) keep working.
export { summarizeBy } from './BulkActionBar';

// Stable empty array for the `extraColumns` default: a fresh `[]` on every
// render would flow down into the memoized MemoWiRow and defeat its memo,
// since callers that omit this prop would otherwise pass a new reference
// every render.
const EMPTY_EXTRA_COLUMNS: string[] = [];

export function WorkItemsGrid({
  results,
  loading,
  searched,
  autoFocus = false,
  emptyMessage,
  dataUpdatedAt,
  isFetching = false,
  activeExternalFilterCount = 0,
  extraColumns = EMPTY_EXTRA_COLUMNS,
  initialSort,
  onClearExternalFilters,
  onSortChange,
  previewVisible = true,
  storageKeyScope,
  triageScope,
  snoozeOrganizationId,
}: {
  results: WorkItemSummary[];
  loading: boolean;
  searched: boolean;
  autoFocus?: boolean;
  emptyMessage?: string;
  dataUpdatedAt?: number;
  isFetching?: boolean;
  activeExternalFilterCount?: number;
  extraColumns?: string[];
  initialSort?: WiSortState;
  onClearExternalFilters?: () => void;
  onSortChange?: (sort: WiSortState) => void;
  previewVisible?: boolean;
  storageKeyScope?: string;
  triageScope?: string;
  snoozeOrganizationId?: string;
}) {
  const state = useWiGridState({
    storageKeyScope,
    initialSort,
    extraColumns,
    onSortChange,
    snoozeOrganizationId,
  });

  const g = useWiGridLogic(
    { results, loading, triageScope, activeExternalFilterCount, onClearExternalFilters, autoFocus },
    state,
  );

  // Duplicate flow: the preview panel hands over a prefilled draft (D key or
  // the header button) and the create dialog finishes the job.
  const [duplicateDraft, setDuplicateDraft] = useState<CreateWorkItemDraft | null>(null);

  const previewStorageKey = storageKeyScope
    ? `${WORK_ITEM_PREVIEW_WIDTH_STORAGE_KEY}:${storageKeyScope}`
    : WORK_ITEM_PREVIEW_WIDTH_STORAGE_KEY;

  const gridPane = (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card">
      {state.showSnoozed && snoozeOrganizationId ? (
        <SnoozedItemsPanel
          organizationId={snoozeOrganizationId}
          itemType="work_item"
          onUnsnoozed={() =>
            state.queryClient.invalidateQueries({
              queryKey: workItemQueryKeys.myItems(snoozeOrganizationId),
            })
          }
        />
      ) : (
      <div ref={state.setGridScrollNode} className="min-h-0 flex-1 overflow-y-auto overflow-x-auto">
        <div style={{ minWidth: state.gridMinWidth }}>
          <WiGridHeader
            displayed={g.displayed}
            checkedIds={state.checkedIds}
            setCheckedIds={state.setCheckedIds}
            setLastCheckedIndex={state.setLastCheckedIndex}
            wiColTemplate={state.wiColTemplate}
            visibleColumns={state.visibleColumns}
            sort={state.sort}
            onSort={state.applyWiSort}
            columnFilters={state.columnFilters}
            onFilterOpen={g.openFilter}
            columnResizeProps={state.columnResizeProps}
            extraColumns={extraColumns}
          />
          <WiGridBody
            showBlockingLoading={g.showBlockingLoading}
            searched={searched}
            sorted={g.sorted}
            displayed={g.displayed}
            emptyMessage={emptyMessage}
            clearAllFilters={g.clearAllFilters}
            firstVirtualRow={g.firstVirtualRow}
            virtualRows={g.virtualRows}
            selectedIndex={state.selectedIndex}
            checkedIds={state.checkedIds}
            unreadKeys={g.unreadKeys}
            wiColTemplate={state.wiColTemplate}
            visibleColumns={state.visibleColumns}
            extraColumns={extraColumns}
            staleThresholdDays={g.staleThresholdDays}
            rowColorRules={g.rowColorRules}
            rowRefs={state.rowRefs}
            virtualTopPadding={g.virtualTopPadding}
            virtualBottomPadding={g.virtualBottomPadding}
            setSelectedIndex={state.setSelectedIndex}
            handleCheckboxChange={g.handleCheckboxChange}
            onShiftRangeSelect={g.selectRangeTo}
            onCtrlToggleSelect={g.toggleSelectionAt}
            onClearSelection={g.clearCheckedIds}
          />
        </div>
      </div>
      )}
      <WiGridStatusBar
        loading={loading}
        searched={searched}
        hasActiveColumnFilters={g.hasActiveColumnFilters}
        displayed={g.displayed}
        sorted={g.sorted}
        dataUpdatedAt={dataUpdatedAt}
        isFetching={isFetching}
        triageScope={triageScope}
        showDone={state.showDone}
        setShowDone={state.setShowDone}
        setSelectedIndex={state.setSelectedIndex}
        archivedKeys={g.archivedKeys}
        snoozeEnabled={state.snoozeEnabled}
        showSnoozed={state.showSnoozed}
        setShowSnoozed={state.setShowSnoozed}
        activeFilterCount={g.activeFilterCount}
        clearAllFilters={g.clearAllFilters}
        staleOnly={state.staleOnly}
        setStaleOnly={state.setStaleOnly}
        staleCount={g.staleCount}
        staleThresholdDays={g.staleThresholdDays}
        setColumnMenuRect={state.setColumnMenuRect}
      />
    </div>
  );

  const previewPane = (
    <WorkItemPreviewPanel
      customPreviewFields={state.customPreviewFields}
      focusCommentRequest={state.focusCommentRequest}
      onCustomPreviewFieldsChange={(fields) => {
        storeCustomPreviewFields(fields);
        state.setCustomPreviewFields(fields);
      }}
      openAssigneeRequest={state.openAssigneeRequest}
      openFieldRequest={state.openFieldRequest}
      openPriorityRequest={state.openPriorityRequest}
      openStateRequest={state.openStateRequest}
      preview={g.previewQuery.data ?? null}
      previewError={g.previewQuery.isError ? commandErrorMessage(g.previewQuery.error) : null}
      previewLoading={g.previewQuery.isFetching}
      selectedItem={g.selectedItem}
      onPreviewUpdated={g.handlePreviewUpdated}
      onDuplicate={(draft) =>
        setDuplicateDraft({
          projectId: draft.projectId,
          workItemType: draft.workItemType ?? undefined,
          title: draft.title,
          priority: draft.priority ?? undefined,
          areaPath: draft.areaPath ?? undefined,
          iterationPath: draft.iterationPath ?? undefined,
          tags: draft.tags.join("; "),
          assignedTo: draft.assignedTo ?? undefined,
        })
      }
    />
  );

  const resultPane = g.selectedItem ? (
    <WorkItemResultSection workItemId={g.selectedItem.id} />
  ) : (
    <div className="flex h-full items-center justify-center p-4">
      <PreviewEmptyState message="Select a work item to see its investigation result." />
    </div>
  );

  return (
    <div
      ref={state.containerRef}
      className="flex min-h-0 flex-1 flex-col outline-none"
      tabIndex={-1}
      onKeyDown={g.handleKeyDown}
      onFocusCapture={g.handleGridFocusCapture}
      onBlurCapture={g.handleGridBlurCapture}
    >
      {state.copyToast || g.bulk.bulkToast ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-3 py-1 text-xs text-background shadow-lg"
        >
          {state.copyToast ?? g.bulk.bulkToast}
        </div>
      ) : null}
      {g.checkedItems.length > 0 ? (
        <BulkActionBar
          count={g.checkedItems.length}
          typeBreakdown={g.bulk.typeBreakdown}
          stateBreakdown={g.bulk.stateBreakdown}
          onClear={() => { state.setCheckedIds(new Set()); state.setLastCheckedIndex(null); }}
          stateOpen={g.bulk.bulkStateOpen}
          onStateOpenChange={(open) => {
            g.bulk.setBulkStateOpen(open);
            if (open) {
              g.bulk.setBulkAssignOpen(false);
              g.bulk.setBulkPriorityOpen(false);
            }
          }}
          stateOptions={g.bulk.bulkStateOptions}
          stateLoading={g.bulk.stateLoading}
          statePending={g.bulk.bulkStateMutation.isPending}
          onStateSelect={(s) => g.bulk.bulkStateMutation.mutate(s)}
          assignOpen={g.bulk.bulkAssignOpen}
          onAssignOpenChange={(open) => {
            g.bulk.setBulkAssignOpen(open);
            if (!open) g.bulk.setBulkAssignQuery("");
            if (open) {
              g.bulk.setBulkStateOpen(false);
              g.bulk.setBulkPriorityOpen(false);
            }
          }}
          assignQuery={g.bulk.bulkAssignQuery}
          onAssignQueryChange={g.bulk.setBulkAssignQuery}
          assignOptions={g.bulk.bulkAssignOptions}
          assignLoading={g.bulk.bulkAssignLoading}
          assignPending={g.bulk.bulkAssignMutation.isPending}
          onAssignSelect={(candidate) => g.bulk.bulkAssignMutation.mutate(candidate)}
          priorityOpen={g.bulk.bulkPriorityOpen}
          onPriorityOpenChange={(open) => {
            g.bulk.setBulkPriorityOpen(open);
            if (open) {
              g.bulk.setBulkStateOpen(false);
              g.bulk.setBulkAssignOpen(false);
            }
          }}
          priorityPending={g.bulk.bulkPriorityMutation.isPending}
          onPrioritySelect={(priority) => g.bulk.bulkPriorityMutation.mutate(priority)}
          tagsPending={g.bulk.bulkTagsMutation.isPending}
          onTagsApply={(tag, mode) => g.bulk.bulkTagsMutation.mutate({ tag, mode })}
          snoozePending={state.snoozeMutation.isPending}
          onSnoozeOpen={(anchorRect) => {
            state.snoozeTargetRef.current = [...g.checkedItems];
            state.setSnoozeAnchorRect(anchorRect);
          }}
        />
      ) : null}
      {g.bulk.bulkFailures.length > 0 ? (
        <BulkFailurePanel
          failures={g.bulk.bulkFailures}
          onDismiss={() => g.bulk.setBulkFailures([])}
        />
      ) : null}
      {previewVisible ? (
        <DockableWorkspace
          storageKey={`${previewStorageKey}:dockview:v1`}
          panels={[
            { id: 'grid', title: 'Work items', content: gridPane, minWidth: 480 },
            {
              id: 'preview',
              title: 'Preview',
              content: previewPane,
              position: { relativeTo: 'grid', direction: 'right' },
              initialWidth: DEFAULT_WORK_ITEM_PREVIEW_WIDTH,
              minWidth: 300,
              maxWidth: MAX_WORK_ITEM_PREVIEW_WIDTH,
            },
            {
              // Tabbed together with Preview by default -- the investigation
              // result is auxiliary content the user can drag into its own
              // split or floating window, not something that should crowd
              // the main preview open by default.
              id: 'result',
              title: 'Result',
              content: resultPane,
              position: { relativeTo: 'preview', direction: 'within' },
              minWidth: 320,
            },
          ] satisfies DockablePanelSpec[]}
        />
      ) : (
        gridPane
      )}
      {state.openFilterCol && state.filterAnchorRect ? (
        <WiColumnFilterDropdown
          anchorRect={state.filterAnchorRect}
          allValues={g.columnUniqueValues[state.openFilterCol] ?? []}
          activeValues={state.columnFilters[state.openFilterCol]}
          onToggle={(value) => g.toggleFilter(state.openFilterCol!, value)}
          onClearAll={() => g.clearColumnFilter(state.openFilterCol!)}
          onUncheckAll={() => g.uncheckAllColumnFilter(state.openFilterCol!)}
          onClose={() => { state.setOpenFilterCol(null); state.setFilterAnchorRect(null); }}
          restoreFocusRef={state.filterButtonRef}
        />
      ) : null}
      {state.columnMenuRect ? (
        <ColumnVisibilityMenu
          anchorRect={state.columnMenuRect}
          columns={WI_GRID_KEYS.map((key) => ({ key, label: wiSortLabels[key] }))}
          visibleColumns={state.visibleColumns}
          requiredColumns={WI_GRID_REQUIRED_COLUMNS}
          onToggle={state.toggleColumnVisibility}
          onReset={state.resetColumnVisibility}
          onClose={() => state.setColumnMenuRect(null)}
        />
      ) : null}
      {duplicateDraft ? (
        <CreateWorkItemDialog
          initialDraft={duplicateDraft}
          onClose={() => setDuplicateDraft(null)}
          onCreated={(item) => {
            state.setCopyToast(`Created #${item.id} "${item.title}"`);
            window.setTimeout(() => state.setCopyToast(null), 3000);
          }}
        />
      ) : null}
      {state.snoozeAnchorRect && snoozeOrganizationId ? (
        <SnoozeMenu
          anchorRect={state.snoozeAnchorRect}
          onSnooze={(snoozeUntil) => {
            const targets = state.snoozeTargetRef.current;
            if (targets.length > 0) {
              state.snoozeMutation.mutate(targets.map((target) => ({
                organizationId: snoozeOrganizationId,
                itemType: "work_item",
                itemKey: String(target.id),
                snoozeUntil,
              })));
              state.setCopyToast(`Snoozed ${targets.length} item${targets.length === 1 ? "" : "s"}`);
              window.setTimeout(() => state.setCopyToast(null), 1500);
            }
            state.setSnoozeAnchorRect(null);
          }}
          onClose={() => state.setSnoozeAnchorRect(null)}
        />
      ) : null}
    </div>
  );
}
