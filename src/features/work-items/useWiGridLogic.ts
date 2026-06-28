import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getWorkItemPreview,
  getAppSettings,
  DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS,
  type WorkItemPreview,
  type WorkItemSummary,
} from '@/lib/azdoCommands';
import { recordRecentWorkItem } from '@/lib/recentItems';
import { isTauriRuntime } from '@/lib/runtime';
import { useGridFocusRestoration } from '@/lib/useGridFocusRestoration';
import { markWorkItemRead, reconcileUnread, seedDemoUnread, workItemUnreadKey } from './workItemUnreadTracking';
import { activeArchivedKeys } from '@/lib/triage';
import { isWorkItemStale } from './workItemStale';
import {
  WI_GRID_ROW_HEIGHT,
  WI_GRID_OVERSCAN,
  FILTERABLE_COLUMNS,
  compareWorkItems,
  activeColumnFilterCount,
  workItemSummaryKey,
  workItemTriageSnapshot,
  type FilterableColumn,
} from './workItemsGridHelpers';
import { useRowColorRules } from './WorkItemGridRow';
import { useBulkActions } from './useBulkActions';
import { workItemQueryKeys } from './queryKeys';
import { createWiKeyHandler } from './wiGridKeyHandler';
import type { WiGridState } from './useWiGridState';

export interface WiGridLogicProps {
  results: WorkItemSummary[];
  loading: boolean;
  triageScope?: string;
  activeExternalFilterCount?: number;
  onClearExternalFilters?: () => void;
  autoFocus: boolean;
}

export function useWiGridLogic(
  props: WiGridLogicProps,
  state: WiGridState,
) {
  const {
    results, triageScope, loading, activeExternalFilterCount = 0,
    onClearExternalFilters, autoFocus,
  } = props;
  const {
    selectedIndex, setSelectedIndex,
    sort,
    checkedIds, setCheckedIds,
    lastCheckedIndex, setLastCheckedIndex,
    columnFilters, setColumnFilters,
    openFilterCol, setOpenFilterCol,
    setFilterAnchorRect,
    itemOverrides, setItemOverrides,
    setColumnMenuRect,
    setCopyToast,
    setFocusCommentRequest,
    setOpenAssigneeRequest, setOpenStateRequest, setOpenPriorityRequest, setOpenFieldRequest,
    setTriageVersion, triageVersion, showDone,
    containerRef, gridScrollRef, rowRefs, previousResultKeysRef,
    setGridViewport,
    queryClient,
    snoozeEnabled, snoozeTargetRef, setSnoozeAnchorRect,
    customPreviewFields,
  } = state;

  // ─── Derived / computed state ─────────────────────────────────────────────

  const archivedKeys = useMemo(() => {
    if (!triageScope) return new Set<string>();
    const snapshots = new Map(
      results.map((item) => [workItemSummaryKey(item), workItemTriageSnapshot(item)]),
    );
    return activeArchivedKeys(triageScope, snapshots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, triageScope, triageVersion]);

  const effectiveResults = useMemo(
    () =>
      results
        .filter(
          (item) =>
            !triageScope || archivedKeys.has(workItemSummaryKey(item)) === showDone,
        )
        .map((item) => ({
          ...item,
          ...(itemOverrides.get(workItemSummaryKey(item)) ?? {}),
        })),
    [archivedKeys, itemOverrides, results, showDone, triageScope],
  );

  const sorted = useMemo(
    () =>
      effectiveResults
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
          const result = compareWorkItems(a.item, b.item, sort.key);
          const directed = sort.direction === "asc" ? result : -result;
          return directed || a.index - b.index;
        })
        .map(({ item }) => item),
    [effectiveResults, sort],
  );

  const columnUniqueValues = useMemo(() => {
    const map = {} as Record<FilterableColumn, string[]>;
    for (const col of Object.keys(FILTERABLE_COLUMNS) as FilterableColumn[]) {
      map[col] = [...new Set(effectiveResults.map(FILTERABLE_COLUMNS[col]))].sort();
    }
    return map;
  }, [effectiveResults]);

  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const staleThresholdDays =
    settingsQuery.data?.workItemStaleThresholdDays ??
    DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS;
  const rowColorRules = useRowColorRules();
  const staleCount = useMemo(() => {
    const now = Date.now();
    return sorted.filter((item) => isWorkItemStale(item, staleThresholdDays, now)).length;
  }, [sorted, staleThresholdDays]);

  const displayed = useMemo(() => {
    const hasFilters = (Object.keys(columnFilters) as FilterableColumn[]).some(
      (col) => columnFilters[col] !== undefined,
    );
    if (!hasFilters && !state.staleOnly) return sorted;
    const now = Date.now();
    return sorted.filter((item) => {
      if (state.staleOnly && !isWorkItemStale(item, staleThresholdDays, now)) return false;
      for (const col of Object.keys(columnFilters) as FilterableColumn[]) {
        const activeValues = columnFilters[col];
        if (!activeValues) continue;
        if (!activeValues.has(FILTERABLE_COLUMNS[col](item))) return false;
      }
      return true;
    });
  }, [sorted, columnFilters, state.staleOnly, staleThresholdDays]);

  const selectedItem = displayed[selectedIndex] ?? null;
  const customPreviewFieldRefs = useMemo(
    () => customPreviewFields.map((field) => field.referenceName),
    [customPreviewFields],
  );
  const customPreviewFieldSignature = customPreviewFieldRefs.join("|");
  const selectedItemKey = selectedItem ? workItemSummaryKey(selectedItem) : null;
  const resultKeysSignature = useMemo(
    () => results.map((item) => workItemSummaryKey(item)).join("|"),
    [results],
  );

  const previewQuery = useQuery({
    queryKey: workItemQueryKeys.preview(
      selectedItem?.organizationId,
      selectedItem?.projectId,
      selectedItem?.id,
      customPreviewFieldSignature,
    ),
    queryFn: () =>
      getWorkItemPreview({
        organizationId: selectedItem?.organizationId,
        projectId: selectedItem?.projectId ?? "",
        workItemId: selectedItem?.id ?? 0,
        customFields: customPreviewFieldRefs,
      }),
    enabled: !!selectedItem,
    staleTime: 30_000,
  });

  const checkedItems = useMemo(
    () => displayed.filter((item) => checkedIds.has(`${item.organizationId}:${item.projectId}:${item.id}`)),
    [displayed, checkedIds],
  );

  const bulk = useBulkActions({
    checkedItems,
    queryClient,
    setItemOverrides,
    setCheckedIds,
    setLastCheckedIndex,
  });

  // ─── Unread tracking ──────────────────────────────────────────────────────

  const [unreadKeys, setUnreadKeys] = useState<Set<string>>(new Set());
  const unreadDemoSeededRef = useRef(false);
  const activitySignature = useMemo(
    () =>
      results
        .map((item) => `${workItemUnreadKey(item.organizationId, item.id)}:${item.changedDate ?? ""}`)
        .join("|"),
    [results],
  );

  useEffect(() => {
    if (!unreadDemoSeededRef.current && !isTauriRuntime()) {
      unreadDemoSeededRef.current = true;
      const candidate = results.find((item) => item.changedDate);
      if (candidate) {
        seedDemoUnread(
          workItemUnreadKey(candidate.organizationId, candidate.id),
          "2000-01-01T00:00:00Z",
        );
      }
    }
    setUnreadKeys(
      reconcileUnread(
        results.map((item) => ({
          key: workItemUnreadKey(item.organizationId, item.id),
          changedDate: item.changedDate,
        })),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activitySignature]);

  useEffect(() => {
    if (!selectedItem) return;
    recordRecentWorkItem(selectedItem);
    const key = workItemUnreadKey(selectedItem.organizationId, selectedItem.id);
    if (unreadKeys.has(key)) {
      markWorkItemRead(key, selectedItem.changedDate);
      setUnreadKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const item of [displayed[selectedIndex - 1], displayed[selectedIndex + 1]]) {
        if (!item) continue;
        void queryClient.prefetchQuery({
          queryKey: workItemQueryKeys.preview(
            item.organizationId,
            item.projectId,
            item.id,
            customPreviewFieldSignature,
          ),
          queryFn: () =>
            getWorkItemPreview({
              organizationId: item.organizationId,
              projectId: item.projectId,
              workItemId: item.id,
              customFields: customPreviewFieldRefs,
            }),
          staleTime: 30_000,
        });
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [customPreviewFieldRefs, customPreviewFieldSignature, displayed, queryClient, selectedIndex]);

  useEffect(() => {
    if (autoFocus) containerRef.current?.focus();
  }, [autoFocus, containerRef]);

  useEffect(() => {
    setSelectedIndex((current) => {
      if (selectedItemKey) {
        const preservedIndex = displayed.findIndex(
          (item) => workItemSummaryKey(item) === selectedItemKey,
        );
        if (preservedIndex >= 0) return preservedIndex;
      }
      return Math.min(current, Math.max(displayed.length - 1, 0));
    });
  }, [displayed, displayed.length, selectedItemKey, setSelectedIndex]);

  useEffect(() => {
    const scroller = gridScrollRef.current;
    if (!scroller) return;
    const scrollerElement = scroller;
    function updateViewport() {
      setGridViewport({ height: scrollerElement.clientHeight, scrollTop: scrollerElement.scrollTop });
    }
    updateViewport();
    scrollerElement.addEventListener("scroll", updateViewport, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateViewport);
    resizeObserver?.observe(scrollerElement);
    return () => {
      scrollerElement.removeEventListener("scroll", updateViewport);
      resizeObserver?.disconnect();
    };
  }, [gridScrollRef, setGridViewport]);

  useEffect(() => {
    const previous = previousResultKeysRef.current;
    previousResultKeysRef.current = resultKeysSignature;
    if (previous === null || previous === resultKeysSignature) return;
    setItemOverrides(new Map());
    setCheckedIds(new Set());
    setLastCheckedIndex(null);
    setOpenFilterCol(null);
  }, [previousResultKeysRef, resultKeysSignature, setCheckedIds, setItemOverrides, setLastCheckedIndex, setOpenFilterCol]);

  const {
    onFocusCapture: handleGridFocusCapture,
    onBlurCapture: handleGridBlurCapture,
  } = useGridFocusRestoration({
    containerRef,
    restoreSignature: `${resultKeysSignature}#${selectedIndex}`,
    restoreFocus: () => {
      const count = displayed.length;
      if (count === 0) return false;
      const index = Math.max(0, Math.min(selectedIndex, count - 1));
      const scroller = gridScrollRef.current;
      if (scroller) {
        const rowTop = index * WI_GRID_ROW_HEIGHT;
        const rowBottom = rowTop + WI_GRID_ROW_HEIGHT;
        if (rowTop < scroller.scrollTop) {
          scroller.scrollTop = rowTop;
        } else if (rowBottom > scroller.scrollTop + scroller.clientHeight) {
          scroller.scrollTop = rowBottom - scroller.clientHeight;
        }
      }
      const node = rowRefs.current[index];
      if (!node) return false;
      node.focus();
      return true;
    },
  });

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function handlePreviewUpdated(preview: WorkItemPreview) {
    const key = workItemSummaryKey(preview);
    setItemOverrides((current) => {
      const next = new Map(current);
      next.set(key, {
        assignedTo: preview.assignedTo,
        changedDate: preview.changedDate,
        state: preview.state,
        workItemType: preview.workItemType,
      });
      return next;
    });
  }

  function moveSelection(index: number) {
    const next = Math.max(0, Math.min(index, displayed.length - 1));
    setSelectedIndex(next);
    const scroller = gridScrollRef.current;
    if (scroller) {
      const rowTop = next * WI_GRID_ROW_HEIGHT;
      const rowBottom = rowTop + WI_GRID_ROW_HEIGHT;
      if (rowTop < scroller.scrollTop) {
        scroller.scrollTop = rowTop;
      } else if (rowBottom > scroller.scrollTop + scroller.clientHeight) {
        scroller.scrollTop = rowBottom - scroller.clientHeight;
      }
    }
    window.setTimeout(() => rowRefs.current[next]?.focus(), 0);
  }

  function handleCheckboxChange(index: number, checked: boolean, shiftKey: boolean) {
    const item = displayed[index];
    if (!item) return;
    const key = `${item.organizationId}:${item.projectId}:${item.id}`;
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastCheckedIndex !== null) {
        const from = Math.min(lastCheckedIndex, index);
        const to = Math.max(lastCheckedIndex, index);
        for (let i = from; i <= to; i++) {
          const it = displayed[i];
          if (!it) continue;
          const k = `${it.organizationId}:${it.projectId}:${it.id}`;
          if (checked) next.add(k); else next.delete(k);
        }
      } else {
        if (checked) next.add(key); else next.delete(key);
      }
      return next;
    });
    setLastCheckedIndex(index);
  }

  function openFilter(col: FilterableColumn, anchorEl: HTMLButtonElement) {
    setFilterAnchorRect(anchorEl.getBoundingClientRect());
    setOpenFilterCol(col);
  }

  function toggleFilter(col: FilterableColumn, value: string) {
    const allValues = columnUniqueValues[col] ?? [];
    setColumnFilters((prev) => {
      const current = prev[col];
      if (!current) {
        const next = new Set(allValues.filter((v) => v !== value));
        return { ...prev, [col]: next };
      }
      const next = new Set(current);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
        if (next.size === allValues.length) {
          const { [col]: _, ...rest } = prev;
          return rest;
        }
      }
      return { ...prev, [col]: next };
    });
  }

  function clearColumnFilter(col: FilterableColumn) {
    setColumnFilters((prev) => {
      const { [col]: _, ...rest } = prev;
      return rest;
    });
  }

  function uncheckAllColumnFilter(col: FilterableColumn) {
    setColumnFilters((prev) => ({ ...prev, [col]: new Set<string>() }));
  }

  function clearAllFilters() {
    setColumnFilters({});
    setOpenFilterCol(null);
    setFilterAnchorRect(null);
    onClearExternalFilters?.();
    setSelectedIndex(0);
  }

  const handleKeyDown = createWiKeyHandler({
    selectedIndex,
    displayed,
    checkedIds,
    checkedItems,
    openFilterCol,
    triageScope,
    snoozeEnabled,
    snoozeTargetRef,
    rowRefs,
    moveSelection,
    setOpenFilterCol,
    setFilterAnchorRect,
    setBulkAssignOpen: bulk.setBulkAssignOpen,
    setBulkStateOpen: bulk.setBulkStateOpen,
    setBulkPriorityOpen: bulk.setBulkPriorityOpen,
    setColumnMenuRect,
    setCopyToast,
    setFocusCommentRequest,
    setTriageVersion,
    setSnoozeAnchorRect,
    setOpenAssigneeRequest,
    setOpenStateRequest,
    setOpenPriorityRequest,
    setOpenFieldRequest,
    handleCheckboxChange,
  });

  // ─── Virtual scroll ───────────────────────────────────────────────────────

  const { gridViewport } = state;
  const columnFilterCount = activeColumnFilterCount(columnFilters);
  const activeFilterCount = Math.max(0, activeExternalFilterCount) + columnFilterCount;
  const hasActiveColumnFilters = columnFilterCount > 0;
  const showBlockingLoading = loading && sorted.length === 0;
  const firstVirtualRow = Math.max(
    0,
    Math.floor(gridViewport.scrollTop / WI_GRID_ROW_HEIGHT) - WI_GRID_OVERSCAN,
  );
  const visibleRowCount = Math.ceil(
    Math.max(gridViewport.height, WI_GRID_ROW_HEIGHT) / WI_GRID_ROW_HEIGHT,
  );
  const lastVirtualRow = Math.min(
    displayed.length,
    firstVirtualRow + visibleRowCount + WI_GRID_OVERSCAN * 2,
  );
  const virtualRows = displayed.slice(firstVirtualRow, lastVirtualRow);
  const virtualTopPadding = firstVirtualRow * WI_GRID_ROW_HEIGHT;
  const virtualBottomPadding = Math.max(0, displayed.length - lastVirtualRow) * WI_GRID_ROW_HEIGHT;

  return {
    archivedKeys, sorted, displayed, columnUniqueValues,
    staleThresholdDays, rowColorRules, staleCount,
    selectedItem, previewQuery, checkedItems, bulk, unreadKeys,
    activeFilterCount, hasActiveColumnFilters, showBlockingLoading,
    handleKeyDown, handleGridFocusCapture, handleGridBlurCapture,
    moveSelection, handleCheckboxChange,
    openFilter, toggleFilter, clearColumnFilter, uncheckAllColumnFilter, clearAllFilters,
    handlePreviewUpdated, firstVirtualRow, virtualRows, virtualTopPadding, virtualBottomPadding,
  };
}
