import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { snoozeItem, type WorkItemSummary } from '@/lib/azdoCommands';
import { storedNumber } from '@/lib/utils';
import { useGridColumns } from '@/lib/useGridColumns';
import type { CustomPreviewField } from './previewFieldsStorage';
import { loadCustomPreviewFields } from './previewFieldsStorage';
import { workItemQueryKeys } from './queryKeys';
import {
  DEFAULT_WI_COLUMN_WIDTHS,
  WI_COLUMN_MIN_WIDTHS,
  WI_COLUMN_MAX_WIDTHS,
  WI_COLUMN_WIDTHS_STORAGE_KEY,
  WI_VISIBLE_COLUMNS_STORAGE_KEY,
  WI_SORT_STORAGE_KEY,
  WI_COLUMN_FILTERS_STORAGE_KEY,
  DEFAULT_WORK_ITEM_PREVIEW_WIDTH,
  MAX_WORK_ITEM_PREVIEW_WIDTH,
  WORK_ITEM_PREVIEW_WIDTH_STORAGE_KEY,
  WI_GRID_KEYS,
  WI_GRID_REQUIRED_COLUMNS,
  loadVisibleWorkItemColumns,
  defaultWorkItemSort,
  loadWorkItemSort,
  loadWorkItemColumnFilters,
  storeWorkItemColumnFilters,
  type WiSortKey,
  type WiSortState,
  type FilterableColumn,
} from './workItemsGridHelpers';

export function useWiGridState({
  storageKeyScope,
  initialSort,
  extraColumns,
  onSortChange,
  snoozeOrganizationId,
}: {
  storageKeyScope?: string;
  initialSort?: WiSortState;
  extraColumns: string[];
  onSortChange?: (sort: WiSortState) => void;
  snoozeOrganizationId?: string;
}) {
  const columnWidthsStorageKey = storageKeyScope
    ? `${WI_COLUMN_WIDTHS_STORAGE_KEY}:${storageKeyScope}`
    : WI_COLUMN_WIDTHS_STORAGE_KEY;
  const visibleColumnsStorageKey = storageKeyScope
    ? `${WI_VISIBLE_COLUMNS_STORAGE_KEY}:${storageKeyScope}`
    : WI_VISIBLE_COLUMNS_STORAGE_KEY;
  const sortStorageKey = storageKeyScope
    ? `${WI_SORT_STORAGE_KEY}:${storageKeyScope}`
    : WI_SORT_STORAGE_KEY;
  const columnFiltersStorageKey = storageKeyScope
    ? `${WI_COLUMN_FILTERS_STORAGE_KEY}:${storageKeyScope}`
    : WI_COLUMN_FILTERS_STORAGE_KEY;
  const previewWidthStorageKey = storageKeyScope
    ? `${WORK_ITEM_PREVIEW_WIDTH_STORAGE_KEY}:${storageKeyScope}`
    : WORK_ITEM_PREVIEW_WIDTH_STORAGE_KEY;

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sort, setWiSort] = useState<WiSortState>(
    initialSort ?? loadWorkItemSort(sortStorageKey, defaultWorkItemSort()),
  );
  const [visibleColumns, setVisibleColumns] = useState<WiSortKey[]>(() =>
    loadVisibleWorkItemColumns(visibleColumnsStorageKey),
  );
  const {
    template: wiColTemplate,
    minWidth: gridMinWidth,
    resetWidths: resetColumnWidths,
    resizeProps: columnResizeProps,
  } = useGridColumns({
    keys: WI_GRID_KEYS,
    visibleColumns,
    flexibleKey: "title",
    defaults: DEFAULT_WI_COLUMN_WIDTHS,
    min: WI_COLUMN_MIN_WIDTHS,
    max: WI_COLUMN_MAX_WIDTHS,
    storageKey: columnWidthsStorageKey,
    prefixColumns: ["28px"],
    suffixColumns: extraColumns.map(() => "120px"),
  });
  const [previewWidth, setPreviewWidth] = useState(() =>
    storedNumber(
      previewWidthStorageKey,
      DEFAULT_WORK_ITEM_PREVIEW_WIDTH,
      300,
      MAX_WORK_ITEM_PREVIEW_WIDTH,
    ),
  );
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [lastCheckedIndex, setLastCheckedIndex] = useState<number | null>(null);
  const [columnMenuRect, setColumnMenuRect] = useState<DOMRect | null>(null);
  const [focusCommentRequest, setFocusCommentRequest] = useState(0);
  const [openAssigneeRequest, setOpenAssigneeRequest] = useState(0);
  const [openStateRequest, setOpenStateRequest] = useState(0);
  const [openPriorityRequest, setOpenPriorityRequest] = useState(0);
  const [openFieldRequest, setOpenFieldRequest] = useState(0);
  const [itemOverrides, setItemOverrides] = useState<Map<string, Partial<WorkItemSummary>>>(new Map());
  const [customPreviewFields, setCustomPreviewFields] = useState<CustomPreviewField[]>(
    () => loadCustomPreviewFields(),
  );
  const [columnFilters, setColumnFilters] = useState<Partial<Record<FilterableColumn, Set<string>>>>(
    () => loadWorkItemColumnFilters(columnFiltersStorageKey),
  );
  const [openFilterCol, setOpenFilterCol] = useState<FilterableColumn | null>(null);
  const [filterAnchorRect, setFilterAnchorRect] = useState<DOMRect | null>(null);
  const [staleOnly, setStaleOnly] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const previousResultKeysRef = useRef<string | null>(null);
  const [gridViewport, setGridViewport] = useState({ height: 0, scrollTop: 0 });
  const queryClient = useQueryClient();
  const [showDone, setShowDone] = useState(false);
  const [triageVersion, setTriageVersion] = useState(0);
  const snoozeEnabled = !!snoozeOrganizationId;
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [snoozeAnchorRect, setSnoozeAnchorRect] = useState<DOMRect | null>(null);
  const snoozeTargetRef = useRef<WorkItemSummary | null>(null);
  const snoozeMutation = useMutation({
    mutationFn: snoozeItem,
    onSuccess: () => {
      if (snoozeOrganizationId) {
        void queryClient.invalidateQueries({
          queryKey: workItemQueryKeys.myItems(snoozeOrganizationId),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: ["snoozedItems", "work_item"],
      });
    },
  });

  // ─── Storage sync effects (1-6) ───────────────────────────────────────────

  useEffect(() => {
    setWiSort(initialSort ?? loadWorkItemSort(sortStorageKey, defaultWorkItemSort()));
  }, [initialSort?.direction, initialSort?.key, sortStorageKey]);

  useEffect(() => {
    setVisibleColumns(loadVisibleWorkItemColumns(visibleColumnsStorageKey));
    setColumnFilters(loadWorkItemColumnFilters(columnFiltersStorageKey));
    setPreviewWidth(
      storedNumber(
        previewWidthStorageKey,
        DEFAULT_WORK_ITEM_PREVIEW_WIDTH,
        300,
        MAX_WORK_ITEM_PREVIEW_WIDTH,
      ),
    );
  }, [columnFiltersStorageKey, previewWidthStorageKey, visibleColumnsStorageKey]);

  useEffect(() => {
    localStorage.setItem(visibleColumnsStorageKey, JSON.stringify(visibleColumns));
  }, [visibleColumns, visibleColumnsStorageKey]);

  useEffect(() => {
    if (!initialSort) {
      localStorage.setItem(sortStorageKey, JSON.stringify(sort));
    }
  }, [initialSort, sort, sortStorageKey]);

  useEffect(() => {
    storeWorkItemColumnFilters(columnFiltersStorageKey, columnFilters);
  }, [columnFilters, columnFiltersStorageKey]);

  useEffect(() => {
    localStorage.setItem(
      previewWidthStorageKey,
      String(Math.round(previewWidth)),
    );
  }, [previewWidth, previewWidthStorageKey]);

  // ─── Column visibility handlers ───────────────────────────────────────────

  function applyWiSort(column: WiSortKey) {
    setWiSort((current) => {
      const next: WiSortState =
        current.key !== column
          ? { key: column, direction: column === "changedDate" ? "desc" : "asc" }
          : { key: column, direction: current.direction === "asc" ? "desc" : "asc" };
      onSortChange?.(next);
      return next;
    });
    setSelectedIndex(0);
  }

  function toggleColumnVisibility(column: WiSortKey) {
    if (WI_GRID_REQUIRED_COLUMNS.includes(column)) return;
    setVisibleColumns((current) =>
      current.includes(column)
        ? current.filter((value) => value !== column)
        : WI_GRID_KEYS.filter((value) => value === column || current.includes(value)),
    );
  }

  function resetColumnVisibility() {
    setVisibleColumns([...WI_GRID_KEYS]);
    resetColumnWidths();
  }

  return {
    selectedIndex, setSelectedIndex,
    sort, setWiSort, applyWiSort,
    visibleColumns, setVisibleColumns,
    toggleColumnVisibility, resetColumnVisibility,
    wiColTemplate, gridMinWidth, resetColumnWidths, columnResizeProps,
    previewWidth, setPreviewWidth,
    copyToast, setCopyToast,
    checkedIds, setCheckedIds,
    lastCheckedIndex, setLastCheckedIndex,
    columnMenuRect, setColumnMenuRect,
    focusCommentRequest, setFocusCommentRequest,
    openAssigneeRequest, setOpenAssigneeRequest,
    openStateRequest, setOpenStateRequest,
    openPriorityRequest, setOpenPriorityRequest,
    openFieldRequest, setOpenFieldRequest,
    itemOverrides, setItemOverrides,
    customPreviewFields, setCustomPreviewFields,
    columnFilters, setColumnFilters,
    openFilterCol, setOpenFilterCol,
    filterAnchorRect, setFilterAnchorRect,
    staleOnly, setStaleOnly,
    containerRef, gridScrollRef, rowRefs, previousResultKeysRef,
    gridViewport, setGridViewport,
    queryClient,
    showDone, setShowDone,
    triageVersion, setTriageVersion,
    snoozeEnabled, showSnoozed, setShowSnoozed,
    snoozeAnchorRect, setSnoozeAnchorRect,
    snoozeTargetRef, snoozeMutation,
  };
}

export type WiGridState = ReturnType<typeof useWiGridState>;
