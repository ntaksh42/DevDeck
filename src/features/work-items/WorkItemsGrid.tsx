import { useState, type CSSProperties } from 'react';
import { commandErrorMessage } from '@/lib/azdoCommands';
import { CreateWorkItemDialog, type CreateWorkItemDraft } from './CreateWorkItemDialog';
import { SnoozeMenu } from '@/components/SnoozeMenu';
import { SnoozedItemsPanel } from '@/components/SnoozedItemsPanel';
import { ResizeHandle } from '@/components/ResizeHandle';
import { ColumnVisibilityMenu } from '@/components/ColumnVisibilityMenu';
import { WorkItemPreviewPanel } from './WorkItemPreviewPanel';
import { storeCustomPreviewFields } from './previewFieldsStorage';
import { workItemQueryKeys } from './queryKeys';
import {
  WI_GRID_KEYS,
  WI_GRID_REQUIRED_COLUMNS,
  wiSortLabels,
  DEFAULT_WORK_ITEM_PREVIEW_WIDTH,
  MAX_WORK_ITEM_PREVIEW_WIDTH,
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

export function WorkItemsGrid({
  results,
  loading,
  searched,
  autoFocus = false,
  emptyMessage,
  dataUpdatedAt,
  isFetching = false,
  activeExternalFilterCount = 0,
  extraColumns = [],
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
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-3 py-1 text-xs text-background shadow-lg">
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
        />
      ) : null}
      {g.bulk.bulkFailures.length > 0 ? (
        <BulkFailurePanel
          failures={g.bulk.bulkFailures}
          onDismiss={() => g.bulk.setBulkFailures([])}
        />
      ) : null}
      <div
        className={`grid min-h-0 flex-1 items-stretch gap-3 ${
          previewVisible
            ? "xl:grid-cols-[minmax(0,1fr)_8px_minmax(300px,var(--work-item-preview-width))]"
            : "xl:grid-cols-[minmax(0,1fr)]"
        }`}
        style={{ "--work-item-preview-width": `${state.previewWidth}px` } as CSSProperties}
      >
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card">
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
          <div ref={state.gridScrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-auto">
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

        {previewVisible ? (
          <>
            <ResizeHandle
              ariaLabel="Resize work item preview"
              className="hidden xl:flex"
              direction={-1}
              max={MAX_WORK_ITEM_PREVIEW_WIDTH}
              min={300}
              onChange={state.setPreviewWidth}
              onReset={() => state.setPreviewWidth(DEFAULT_WORK_ITEM_PREVIEW_WIDTH)}
              value={state.previewWidth}
            />

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
          </>
        ) : null}
      </div>
      {state.openFilterCol && state.filterAnchorRect ? (
        <WiColumnFilterDropdown
          anchorRect={state.filterAnchorRect}
          allValues={g.columnUniqueValues[state.openFilterCol] ?? []}
          activeValues={state.columnFilters[state.openFilterCol]}
          onToggle={(value) => g.toggleFilter(state.openFilterCol!, value)}
          onClearAll={() => g.clearColumnFilter(state.openFilterCol!)}
          onUncheckAll={() => g.uncheckAllColumnFilter(state.openFilterCol!)}
          onClose={() => { state.setOpenFilterCol(null); state.setFilterAnchorRect(null); }}
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
            const target = state.snoozeTargetRef.current;
            if (target) {
              state.snoozeMutation.mutate({
                organizationId: snoozeOrganizationId,
                itemType: "work_item",
                itemKey: String(target.id),
                snoozeUntil,
              });
            }
            state.setSnoozeAnchorRect(null);
          }}
          onClose={() => state.setSnoozeAnchorRect(null)}
        />
      ) : null}
    </div>
  );
}
