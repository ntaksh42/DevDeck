import { type CSSProperties } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { commandErrorMessage } from '@/lib/azdoCommands';
import { isEditableTarget, focusPrimaryPreview } from '@/lib/utils';
import { SnoozeMenu } from '@/components/SnoozeMenu';
import { SnoozedItemsPanel } from '@/components/SnoozedItemsPanel';
import { ColumnResizeHandle } from '@/components/ResizeHandle';
import { ResizeHandle } from '@/components/ResizeHandle';
import { ColumnVisibilityMenu } from '@/components/ColumnVisibilityMenu';
import { ColumnFilterDropdown } from '@/components/ColumnFilterDropdown';
import { SortHeaderButton } from '@/components/SortHeaderButton';
import { LoadingState, ErrorState } from '@/components/StateDisplay';
import { openExternalUrl } from '@/lib/openExternal';
import { toggleTriageArchived } from '@/lib/triage';
import { PrReviewPanel } from './PrReviewPanel';
import { ReviewPrRow } from './ReviewPrRow';
import { ReviewFilterBar } from './ReviewFilterBar';
import { ReviewStatusBar } from './ReviewStatusBar';
import { OverlapPopup } from './OverlapPopup';
import { reviewTriageKey, reviewTriageSnapshot } from './myReviewsHelpers';
import { isFilterableColumn, sortLabels, PR_GRID_KEYS, PR_GRID_REQUIRED_COLUMNS, MAX_REVIEW_PREVIEW_WIDTH, MIN_REVIEW_PREVIEW_WIDTH, DEFAULT_REVIEW_PREVIEW_WIDTH } from './myReviewsTypes';
import { useMyReviewsGrid } from './useMyReviewsGrid';
import type { MyReviewsGridProps } from './myReviewsTypes';

// Re-export for callers that imported from this path.
export { reviewAgeDays } from './myReviewsHelpers';
export type { MyReviewsSelectRequest } from './myReviewsTypes';

export function MyReviewsGrid({
  organizations,
  selectRequest,
  onSelectRequestHandled,
}: MyReviewsGridProps) {
  const g = useMyReviewsGrid({ organizations, selectRequest, onSelectRequestHandled });

  function handleKeyDown(e: React.KeyboardEvent) {
    const editable = isEditableTarget(e.target);
    const buttonTarget = (e.target instanceof HTMLElement ? e.target : null)?.closest('button');

    if (editable) {
      if (e.key === 'Escape') {
        e.preventDefault();
        g.setTextFilter('');
        g.setSelectedIndex(0);
        (e.target as HTMLElement).blur();
      } else if (e.key === 'ArrowDown' && g.visibleSortedIndexes.length > 0) {
        e.preventDefault();
        const position = g.visibleSortedIndexes.indexOf(g.selectedIndex);
        g.selectVisiblePosition(position < 0 ? 0 : position);
      }
      return;
    }

    if (buttonTarget && (e.key === 'Enter' || e.key === ' ')) return;

    if (e.ctrlKey || e.metaKey || e.altKey) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === 'Enter') {
        e.preventDefault();
        const pr = g.sortedPrs[g.selectedIndex];
        if (pr?.webUrl) openExternalUrl(pr.webUrl);
      }
      return;
    }

    if (e.key === '/') {
      e.preventDefault();
      g.filterInputRef.current?.focus();
      g.filterInputRef.current?.select();
      return;
    }
    if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      g.setShowDrafts((v) => !v);
      g.setSelectedIndex(0);
      return;
    }
    if (e.key === '\\') { e.preventDefault(); g.setMaximized((v) => !v); return; }
    if (e.key === 'o' || e.key === 'O') {
      e.preventDefault();
      const pr = g.sortedPrs[g.selectedIndex];
      if (pr?.webUrl) openExternalUrl(pr.webUrl);
      return;
    }
    if (e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      const pr = g.sortedPrs[g.selectedIndex];
      if (pr) {
        toggleTriageArchived(g.triageScope, reviewTriageKey(pr), reviewTriageSnapshot(pr));
        g.setTriageVersion((v) => v + 1);
      }
      return;
    }
    if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      const pr = g.sortedPrs[g.selectedIndex];
      if (pr) {
        g.snoozeTargetRef.current = pr;
        const rowEl = g.rowRefs.current[g.selectedIndex];
        g.setSnoozeAnchorRect(
          (rowEl ?? g.containerRef.current)?.getBoundingClientRect() ?? null,
        );
      }
      return;
    }
    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      const pr = g.sortedPrs[g.selectedIndex];
      if (pr?.webUrl) {
        void navigator.clipboard.writeText(pr.webUrl).then(
          () => { g.setCopyToast('URL copied'); setTimeout(() => g.setCopyToast(null), 1500); },
          () => { g.setCopyToast('Copy failed'); setTimeout(() => g.setCopyToast(null), 1500); },
        );
      }
      return;
    }
    if (e.key === 'a' || e.key === 'A') { e.preventDefault(); g.voteSelected(10, 'Approve'); return; }
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); g.voteSelected(5, 'Suggestions'); return; }
    if (e.key === 'w' || e.key === 'W') { e.preventDefault(); g.voteSelected(-5, 'Wait'); return; }
    if (e.key === 'x' || e.key === 'X') { e.preventDefault(); g.voteSelected(-10, 'Reject'); return; }
    if (e.key === '0') { e.preventDefault(); g.voteSelected(0, 'No vote'); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (g.openFilterCol) { g.setOpenFilterCol(null); g.setFilterAnchorRect(null); return; }
      g.clearAllFilters();
      return;
    }
    if (g.visibleSortedIndexes.length === 0) return;
    if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const position = g.visibleSortedIndexes.indexOf(g.selectedIndex);
      const base = position < 0 ? 0 : position;
      const nextPosition = Math.max(
        0,
        Math.min(base + (e.key === 'ArrowDown' ? 1 : -1), g.visibleSortedIndexes.length - 1),
      );
      const targetIndex = g.visibleSortedIndexes[nextPosition];
      const anchorKey =
        g.selectionAnchor ??
        reviewTriageKey(g.sortedPrs[g.selectedIndex] ?? g.sortedPrs[targetIndex]);
      g.setSelectedIndex(targetIndex);
      g.scrollPrIntoView(targetIndex);
      window.setTimeout(() => g.focusRow(targetIndex), 0);
      g.extendSelectionToIndex(targetIndex, anchorKey);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'J') {
      e.preventDefault(); g.clearMultiSelection(); g.moveSelectionBy(1);
    } else if (e.key === 'ArrowUp' || e.key === 'k' || e.key === 'K') {
      e.preventDefault(); g.clearMultiSelection(); g.moveSelectionBy(-1);
    } else if (e.key === 'Home') {
      e.preventDefault(); g.clearMultiSelection(); g.selectVisiblePosition(0);
    } else if (e.key === 'End') {
      e.preventDefault(); g.clearMultiSelection(); g.selectVisiblePosition(g.visibleSortedIndexes.length - 1);
    } else if (e.key === 'PageDown') {
      e.preventDefault(); g.clearMultiSelection(); g.moveSelectionBy(10);
    } else if (e.key === 'PageUp') {
      e.preventDefault(); g.clearMultiSelection(); g.moveSelectionBy(-10);
    } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
      e.preventDefault(); focusPrimaryPreview();
    }
  }

  return (
    <div
      ref={g.containerRef}
      className="flex min-h-0 flex-1 flex-col gap-2 outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onFocusCapture={g.handleGridFocusCapture}
      onBlurCapture={g.handleGridBlurCapture}
    >
      {g.copyToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 rounded-md bg-foreground px-3 py-2 text-sm text-background shadow-lg"
        >
          {g.copyToast}
        </div>
      )}
      <ReviewFilterBar
        organizations={organizations}
        organizationId={g.organizationId}
        onOrganizationChange={(id) => { g.setOrganizationId(id); g.setSelectedIndex(0); g.clearMultiSelection(); }}
        textFilter={g.textFilter}
        onTextFilterChange={(v) => { g.setTextFilter(v); g.setSelectedIndex(0); }}
        filterInputRef={g.filterInputRef}
        showDrafts={g.showDrafts}
        onShowDraftsChange={(checked) => { g.setShowDrafts(checked); g.setSelectedIndex(0); }}
        filterSuggestionPool={g.filterSuggestionPool}
      />
      <div
        className={
          g.maximized
            ? 'flex min-h-0 flex-1'
            : 'grid min-h-0 flex-1 items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_8px_minmax(280px,var(--review-preview-width))]'
        }
        style={{ '--review-preview-width': `${g.previewWidth}px` } as CSSProperties}
      >
        <div
          className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card ${g.maximized ? 'hidden' : ''}`}
        >
          {g.showSnoozed ? (
            <SnoozedItemsPanel
              organizationId={g.organizationId}
              itemType="pull_request"
              onUnsnoozed={() => g.queryClient.invalidateQueries({ queryKey: ['myReviews'] })}
            />
          ) : (
            <div ref={g.scrollerRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-auto">
              <div style={{ minWidth: g.gridMinWidth }}>
                <div
                  role="row"
                  className="grid items-center gap-2 border-b border-border bg-muted px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  style={{ gridTemplateColumns: g.COLS }}
                >
                  {g.visibleColumns.map((col, i) => {
                    const isLast = i === g.visibleColumns.length - 1;
                    return (
                      <SortHeaderButton
                        key={col}
                        column={col}
                        label={sortLabels[col]}
                        sort={g.sort}
                        onSort={g.applySort}
                        filterActive={isFilterableColumn(col) && g.columnFilters[col] !== undefined}
                        onFilterOpen={isFilterableColumn(col) ? (el) => g.openFilter(col, el) : undefined}
                        resizeHandle={isLast ? undefined : <ColumnResizeHandle {...g.columnResizeProps(col)} />}
                      />
                    );
                  })}
                </div>
                {g.query.isLoading ? (
                  <LoadingState />
                ) : g.query.isError ? (
                  <ErrorState message={commandErrorMessage(g.query.error)} onRetry={() => void g.query.refetch()} />
                ) : g.sortedPrs.length === 0 ? (
                  <div className="flex min-h-24 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                    <span>{g.allPrs.length === 0 ? 'No pull requests assigned to you.' : 'No results match the current filter.'}</span>
                    {g.isFiltered ? (
                      <button type="button" onClick={g.clearAllFilters} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-secondary">
                        Clear filters
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div role="grid" aria-label="My review pull requests" data-primary-grid="true" tabIndex={-1}>
                    {g.virtualTopPadding > 0 ? <div style={{ height: g.virtualTopPadding }} /> : null}
                    {g.virtualRows.map((row) => {
                      if (row.kind === 'header') {
                        const collapsed = g.collapsedSections.has(row.key);
                        return (
                          <button
                            key={`header:${row.key}`}
                            type="button"
                            onClick={() => g.toggleSection(row.key)}
                            aria-expanded={!collapsed}
                            className="flex h-[29px] w-full items-center gap-1 border-b border-border bg-muted/60 px-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted focus:outline-none focus:ring-1 focus:ring-inset focus:ring-ring"
                          >
                            {collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                            {row.label}
                            <span className="font-normal normal-case">({row.count})</span>
                          </button>
                        );
                      }
                      return (
                        <ReviewPrRow
                          key={`${row.pr.organizationId}-${row.pr.repositoryId}-${row.pr.pullRequestId}`}
                          ref={(el) => { g.rowRefs.current[row.prIndex] = el; }}
                          columnTemplate={g.COLS}
                          pr={row.pr}
                          selected={row.prIndex === g.selectedIndex}
                          inMultiSelection={g.selectedKeys.has(reviewTriageKey(row.pr))}
                          returned={g.returnedKeys.has(reviewTriageKey(row.pr))}
                          visibleColumns={g.visibleColumns}
                          staleThresholdDays={g.staleThresholdDays}
                          onSelect={({ shiftKey }) => {
                            if (shiftKey) {
                              const anchorKey = g.selectionAnchor ?? reviewTriageKey(g.sortedPrs[g.selectedIndex] ?? row.pr);
                              g.setSelectedIndex(row.prIndex);
                              g.extendSelectionToIndex(row.prIndex, anchorKey);
                            } else {
                              g.clearMultiSelection();
                              g.setSelectedIndex(row.prIndex);
                            }
                          }}
                        />
                      );
                    })}
                    {g.virtualBottomPadding > 0 ? <div style={{ height: g.virtualBottomPadding }} /> : null}
                  </div>
                )}
              </div>
            </div>
          )}
          <ReviewStatusBar
            visiblePrs={g.visiblePrs}
            noVoteCount={g.noVoteCount}
            returnedKeys={g.returnedKeys}
            isMultiSelect={g.isMultiSelect}
            changesLoading={g.changesLoading}
            selectedPrs={g.selectedPrs}
            overlap={g.overlap}
            overlapPopupOpen={g.overlapPopupOpen}
            overlapButtonRef={g.overlapButtonRef}
            singleFileCount={g.singleFileCount}
            showDone={g.showDone}
            archivedKeys={g.archivedKeys}
            showSnoozed={g.showSnoozed}
            activeFilterCount={g.activeFilterCount}
            sortedPrsCount={g.sortedPrs.length}
            onToggleOverlapPopup={() => g.setOverlapPopupOpen((v) => !v)}
            onToggleShowDone={() => { g.setShowDone((v) => !v); g.setSelectedIndex(0); }}
            onToggleShowSnoozed={() => g.setShowSnoozed((v) => !v)}
            onClearAllFilters={g.clearAllFilters}
            onOpenColumnMenu={(rect) => g.setColumnMenuRect(rect)}
          />
        </div>
        <ResizeHandle
          ariaLabel="Resize review preview"
          className={g.maximized ? 'hidden' : 'hidden xl:flex'}
          direction={-1}
          max={MAX_REVIEW_PREVIEW_WIDTH}
          min={MIN_REVIEW_PREVIEW_WIDTH}
          onChange={g.setPreviewWidth}
          onReset={() => g.setPreviewWidth(DEFAULT_REVIEW_PREVIEW_WIDTH)}
          value={g.previewWidth}
        />
        <PrReviewPanel
          selectedPr={g.selectedPr}
          maximized={g.maximized}
          onToggleMaximize={() => g.setMaximized((v) => !v)}
        />
      </div>
      {g.openFilterCol && g.filterAnchorRect ? (
        <ColumnFilterDropdown
          anchorRect={g.filterAnchorRect}
          allValues={g.columnUniqueValues[g.openFilterCol] ?? []}
          activeValues={g.columnFilters[g.openFilterCol]}
          onToggle={(value) => g.toggleFilter(g.openFilterCol!, value)}
          onClearAll={() => g.clearColumnFilter(g.openFilterCol!)}
          restoreFocusRef={g.filterButtonRef}
          onUncheckAll={() => g.uncheckAllColumnFilter(g.openFilterCol!)}
          onClose={() => { g.setOpenFilterCol(null); g.setFilterAnchorRect(null); }}
        />
      ) : null}
      {g.columnMenuRect ? (
        <ColumnVisibilityMenu
          anchorRect={g.columnMenuRect}
          columns={PR_GRID_KEYS.map((key) => ({ key, label: sortLabels[key] }))}
          visibleColumns={g.visibleColumns}
          requiredColumns={PR_GRID_REQUIRED_COLUMNS}
          onToggle={g.toggleColumn}
          onReset={g.resetColumns}
          onClose={() => g.setColumnMenuRect(null)}
        />
      ) : null}
      {g.snoozeAnchorRect ? (
        <SnoozeMenu
          anchorRect={g.snoozeAnchorRect}
          onSnooze={(snoozeUntil) => {
            const target = g.snoozeTargetRef.current;
            if (target) {
              g.snoozeMutation.mutate({
                organizationId: g.organizationId,
                itemType: 'pull_request',
                itemKey: `${target.repositoryId}:${target.pullRequestId}`,
                snoozeUntil,
              });
              g.setCopyToast('Snoozed');
              setTimeout(() => g.setCopyToast(null), 1500);
            }
            g.setSnoozeAnchorRect(null);
          }}
          onClose={() => g.setSnoozeAnchorRect(null)}
        />
      ) : null}
      {g.overlapPopupOpen && g.overlap.fileCount > 0 ? (
        <OverlapPopup
          anchorEl={g.overlapButtonRef.current}
          overlaps={g.overlap.overlaps}
          prKeyToLabel={g.prKeyToLabel}
          onClose={() => { g.setOverlapPopupOpen(false); g.overlapButtonRef.current?.focus(); }}
        />
      ) : null}
    </div>
  );
}
