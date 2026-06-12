import {
  type CSSProperties,
  type ReactNode,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Filter, Loader2, X } from 'lucide-react';
import {
  setWorkItemsState,
  assignWorkItems,
  setWorkItemsPriority,
  listWorkItemTypeStates,
  recordAssigneeInteraction,
  searchWorkItemAssignees,
  getWorkItemPreview,
  commandErrorMessage,
  type BulkWorkItemResult,
  type WorkItemAssigneeCandidate,
  type WorkItemPreview,
  type WorkItemSummary,
} from '@/lib/azdoCommands';
import {
  storedNumbers,
  storedNumber,
  gridColumnTemplate,
  isEditableTarget,
  focusPrimaryPreview,
  formatRelativeDate,
  type SortDirection,
} from '@/lib/utils';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { openExternalUrl } from '@/lib/openExternal';
import { ShortcutHint } from '@/components/ShortcutHint';
import { activeArchivedKeys, toggleTriageArchived } from '@/lib/triage';
import { ColumnResizeHandle, ResizeHandle } from '@/components/ResizeHandle';
import { LoadingState } from '@/components/StateDisplay';
import { WorkItemPreviewPanel } from './WorkItemPreviewPanel';
import { invalidateWorkItemMutationCaches, workItemQueryKeys } from './queryKeys';
import {
  loadCustomPreviewFields,
  storeCustomPreviewFields,
  type CustomPreviewField,
} from './previewFieldsStorage';
const DEFAULT_WI_COLUMN_WIDTHS = [46, 64, 60, 180, 82, 84, 68];
const WI_COLUMN_MIN_WIDTHS = [44, 58, 56, 150, 70, 74, 60];
const WI_COLUMN_MAX_WIDTHS = [120, 200, 180, 720, 300, 260, 160];
const WI_COLUMN_WIDTHS_STORAGE_KEY = "azdodeck:layout:wiSearchGridColumnWidths:v2";
const WI_VISIBLE_COLUMNS_STORAGE_KEY = "azdodeck:layout:wiSearchGridVisibleColumns:v1";
const WI_SORT_STORAGE_KEY = "azdodeck:view:wiSearchGridSort:v1";
const WI_COLUMN_FILTERS_STORAGE_KEY = "azdodeck:view:wiSearchGridColumnFilters:v1";
const DEFAULT_WORK_ITEM_PREVIEW_WIDTH = 440;
// Effectively unbounded: the pane is still capped by the window because the
// preview grid column is minmax(300px, var(--work-item-preview-width)).
const MAX_WORK_ITEM_PREVIEW_WIDTH = 8192;
const WORK_ITEM_PREVIEW_WIDTH_STORAGE_KEY = "azdodeck:layout:workItemPreviewWidth";
const WI_GRID_ROW_HEIGHT = 29;
const WI_GRID_OVERSCAN = 8;
const RECENT_WORK_ITEMS_STORAGE_KEY = "azdodeck:workItems:recent";
type WiSortKey =
  | "id"
  | "workItemType"
  | "state"
  | "title"
  | "projectName"
  | "assignedTo"
  | "changedDate";
type WiSortState = { key: WiSortKey; direction: SortDirection };

function workItemSummaryKey(item: Pick<WorkItemSummary, "organizationId" | "projectId" | "id">): string {
  return `${item.organizationId}:${item.projectId}:${item.id}`;
}

// ChangedDate bumps on every revision, so an archived item resurfaces as soon
// as it changes in Azure DevOps.
function workItemTriageSnapshot(item: WorkItemSummary): string {
  return item.changedDate ?? "";
}

const wiSortLabels: Record<WiSortKey, string> = {
  id: "#",
  workItemType: "Type",
  state: "State",
  title: "Title",
  projectName: "Project",
  assignedTo: "Assigned To",
  changedDate: "Changed",
};

function compareWorkItems(a: WorkItemSummary, b: WorkItemSummary, key: WiSortKey): number {
  switch (key) {
    case "id":
      return a.id - b.id;
    case "workItemType":
      return (a.workItemType ?? "￿").localeCompare(b.workItemType ?? "￿");
    case "state":
      return (a.state ?? "￿").localeCompare(b.state ?? "￿");
    case "title":
      return a.title.localeCompare(b.title);
    case "projectName":
      return a.projectName.localeCompare(b.projectName);
    case "assignedTo":
      return (a.assignedTo ?? "￿").localeCompare(b.assignedTo ?? "￿");
    case "changedDate":
      return (a.changedDate ?? "").localeCompare(b.changedDate ?? "");
  }
}

function WiSortHeaderButton({
  column,
  sort,
  onSort,
  resizeHandle,
  filterActive,
  onFilterOpen,
}: {
  column: WiSortKey;
  sort: WiSortState;
  onSort: (column: WiSortKey) => void;
  resizeHandle?: ReactNode;
  filterActive?: boolean;
  onFilterOpen?: (anchorEl: HTMLButtonElement) => void;
}) {
  const active = sort.key === column;
  const label = wiSortLabels[column];
  return (
    <div
      role="columnheader"
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className="relative min-w-0"
    >
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          aria-label={`Sort by ${label}`}
          onClick={() => onSort(column)}
          className={`flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring ${
            active ? "text-foreground" : ""
          }`}
        >
          <span className="truncate">{label}</span>
          {active ? (
            sort.direction === "asc" ? (
              <ChevronUp className="h-3 w-3 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
            )
          ) : (
            <span className="h-3 w-3 shrink-0" aria-hidden="true" />
          )}
        </button>
        {onFilterOpen && (
          <button
            type="button"
            aria-label={`Filter by ${label}`}
            onClick={(e) => onFilterOpen(e.currentTarget)}
            className={`shrink-0 rounded p-0.5 focus:outline-none focus:ring-1 focus:ring-ring ${
              filterActive
                ? "text-primary"
                : "text-muted-foreground/40 hover:text-muted-foreground"
            }`}
          >
            <Filter className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </div>
      {resizeHandle}
    </div>
  );
}

const WI_GRID_KEYS: WiSortKey[] = [
  "id",
  "workItemType",
  "state",
  "title",
  "projectName",
  "assignedTo",
  "changedDate",
];
const WI_GRID_REQUIRED_COLUMNS: WiSortKey[] = ["id", "title"];

function loadVisibleWorkItemColumns(key: string): WiSortKey[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null");
    if (!Array.isArray(parsed)) return [...WI_GRID_KEYS];
    const visible = parsed.filter((value): value is WiSortKey =>
      WI_GRID_KEYS.includes(value as WiSortKey),
    );
    for (const required of WI_GRID_REQUIRED_COLUMNS) {
      if (!visible.includes(required)) visible.push(required);
    }
    return visible.length > 0 ? visible : [...WI_GRID_KEYS];
  } catch {
    return [...WI_GRID_KEYS];
  }
}

function defaultWorkItemSort(): WiSortState {
  return { key: "changedDate", direction: "desc" };
}

function loadWorkItemSort(key: string, fallback: WiSortState): WiSortState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null");
    if (
      !parsed ||
      !WI_GRID_KEYS.includes(parsed.key) ||
      (parsed.direction !== "asc" && parsed.direction !== "desc")
    ) {
      return fallback;
    }
    return { key: parsed.key, direction: parsed.direction };
  } catch {
    return fallback;
  }
}

function loadWorkItemColumnFilters(
  key: string,
): Partial<Record<FilterableColumn, Set<string>>> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const filters: Partial<Record<FilterableColumn, Set<string>>> = {};
    for (const column of Object.keys(FILTERABLE_COLUMNS) as FilterableColumn[]) {
      const values = parsed[column];
      if (Array.isArray(values)) {
        const cleaned = values.filter((value): value is string => typeof value === "string");
        if (cleaned.length > 0) filters[column] = new Set(cleaned);
      }
    }
    return filters;
  } catch {
    return {};
  }
}

function storeWorkItemColumnFilters(
  key: string,
  filters: Partial<Record<FilterableColumn, Set<string>>>,
) {
  const serialized: Partial<Record<FilterableColumn, string[]>> = {};
  for (const column of Object.keys(FILTERABLE_COLUMNS) as FilterableColumn[]) {
    const values = filters[column];
    if (values && values.size > 0) serialized[column] = [...values];
  }
  window.localStorage.setItem(key, JSON.stringify(serialized));
}

function activeColumnFilterCount(
  filters: Partial<Record<FilterableColumn, Set<string>>>,
): number {
  return (Object.values(filters) as (Set<string> | undefined)[]).filter(
    (values) => values && values.size > 0,
  ).length;
}

function workItemCellValue(item: WorkItemSummary, column: WiSortKey): ReactNode {
  switch (column) {
    case "id":
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (item.webUrl) openExternalUrl(item.webUrl);
          }}
          className="truncate text-left font-mono text-xs text-primary hover:underline"
          title={`#${item.id}`}
        >
          #{item.id}
        </button>
      );
    case "workItemType":
      return (
        <span className="truncate text-xs text-muted-foreground" title={item.workItemType ?? undefined}>
          {item.workItemType ?? "—"}
        </span>
      );
    case "state":
      return (
        <span className="truncate text-xs" title={item.state ?? undefined}>
          {item.state ?? "—"}
        </span>
      );
    case "title":
      return (
        <span className="truncate font-medium text-foreground" title={item.title}>
          {item.title}
        </span>
      );
    case "projectName":
      return (
        <span className="truncate text-xs text-muted-foreground" title={item.projectName}>
          {item.projectName}
        </span>
      );
    case "assignedTo":
      return (
        <span
          className="truncate text-xs text-muted-foreground"
          title={item.assignedTo ?? "Unassigned"}
        >
          {item.assignedTo ?? "—"}
        </span>
      );
    case "changedDate":
      return (
        <span
          className="text-xs text-muted-foreground"
          title={item.changedDate ? new Date(item.changedDate).toLocaleString() : undefined}
        >
          {item.changedDate ? formatRelativeDate(item.changedDate) : "—"}
        </span>
      );
  }
}

function extraFieldValue(item: WorkItemSummary, referenceName: string): string | null {
  return (
    item.extraFields.find(
      (field) => field.referenceName.toLowerCase() === referenceName.toLowerCase(),
    )?.value ?? null
  );
}

export function extraColumnLabel(referenceName: string): string {
  return referenceName.split(".").pop() || referenceName;
}

type FilterableColumn = "workItemType" | "state" | "projectName" | "assignedTo";
const FILTERABLE_COLUMNS: Record<FilterableColumn, (item: WorkItemSummary) => string> = {
  workItemType: (item) => item.workItemType ?? "(empty)",
  state: (item) => item.state ?? "(empty)",
  projectName: (item) => item.projectName,
  assignedTo: (item) => item.assignedTo ?? "(Unassigned)",
};
function isFilterableColumn(col: WiSortKey): col is FilterableColumn {
  return col in FILTERABLE_COLUMNS;
}

function recordRecentWorkItem(item: WorkItemSummary) {
  try {
    const current = JSON.parse(
      window.localStorage.getItem(RECENT_WORK_ITEMS_STORAGE_KEY) ?? "[]",
    );
    const list = Array.isArray(current) ? current : [];
    const key = `${item.organizationId}:${item.projectId}:${item.id}`;
    const next = [
      {
        key,
        id: item.id,
        organizationId: item.organizationId,
        projectId: item.projectId,
        projectName: item.projectName,
        title: item.title,
        viewedAt: new Date().toISOString(),
        webUrl: item.webUrl,
      },
      ...list.filter((entry) => entry?.key !== key),
    ].slice(0, 20);
    window.localStorage.setItem(RECENT_WORK_ITEMS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Recent items are a convenience only.
  }
}

const WorkItemGridRow = forwardRef<
  HTMLDivElement,
  {
    item: WorkItemSummary;
    selected: boolean;
    checked: boolean;
    columnTemplate: string;
    visibleColumns: WiSortKey[];
    extraColumns: string[];
    onSelect: () => void;
    onCheckedChange: (checked: boolean, shiftKey: boolean) => void;
  }
>(({ item, selected, checked, columnTemplate, visibleColumns, extraColumns, onSelect, onCheckedChange }, ref) => (
  <div
    ref={ref}
    tabIndex={selected ? 0 : -1}
    role="row"
    aria-selected={selected}
    onClick={onSelect}
    onKeyDown={(e) => {
      if ((e.target as HTMLElement).closest("button,input")) return;
      if (e.key === "Enter") {
        e.stopPropagation();
        if (e.ctrlKey && item.webUrl) openExternalUrl(item.webUrl);
        else focusPrimaryPreview();
      } else if ((e.key === "o" || e.key === "O") && item.webUrl) {
        e.stopPropagation();
        openExternalUrl(item.webUrl);
      }
    }}
    className={`grid cursor-pointer select-none items-center gap-2 border-b border-border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
      checked ? "bg-primary/5" : selected ? "bg-secondary" : "hover:bg-muted/50"
    }`}
    style={{ gridTemplateColumns: columnTemplate }}
  >
    <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={checked}
        aria-label={`Select #${item.id}`}
        onChange={() => {}}
        onClick={(e) => {
          e.stopPropagation();
          onCheckedChange(e.currentTarget.checked, e.shiftKey);
        }}
        className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300"
      />
    </div>
    {visibleColumns.map((column) => (
      <div
        key={column}
        className="min-w-0 truncate"
        style={
          column === "title" && item.depth
            ? { paddingLeft: Math.min(item.depth, 8) * 14 }
            : undefined
        }
      >
        {workItemCellValue(item, column)}
      </div>
    ))}
    {extraColumns.map((referenceName) => {
      const value = extraFieldValue(item, referenceName);
      return (
        <div key={referenceName} className="min-w-0 truncate">
          <span className="truncate text-xs text-muted-foreground" title={value ?? undefined}>
            {value ?? "—"}
          </span>
        </div>
      );
    })}
  </div>
));
WorkItemGridRow.displayName = "WorkItemGridRow";

export function WorkItemsGrid({
  results,
  loading,
  searched,
  autoFocus = false,
  emptyMessage,
  dataUpdatedAt,
  activeExternalFilterCount = 0,
  extraColumns = [],
  initialSort,
  onClearExternalFilters,
  onSortChange,
  previewVisible = true,
  storageKeyScope,
  triageScope,
}: {
  results: WorkItemSummary[];
  loading: boolean;
  searched: boolean;
  autoFocus?: boolean;
  emptyMessage?: string;
  dataUpdatedAt?: number;
  activeExternalFilterCount?: number;
  extraColumns?: string[];
  initialSort?: WiSortState;
  onClearExternalFilters?: () => void;
  onSortChange?: (sort: WiSortState) => void;
  previewVisible?: boolean;
  storageKeyScope?: string;
  triageScope?: string;
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
  const [columnWidths, setColumnWidths] = useState(() =>
    storedNumbers(columnWidthsStorageKey, DEFAULT_WI_COLUMN_WIDTHS, WI_COLUMN_MIN_WIDTHS, WI_COLUMN_MAX_WIDTHS),
  );
  const [visibleColumns, setVisibleColumns] = useState<WiSortKey[]>(() =>
    loadVisibleWorkItemColumns(visibleColumnsStorageKey),
  );
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
  const [bulkStateOpen, setBulkStateOpen] = useState(false);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkPriorityOpen, setBulkPriorityOpen] = useState(false);
  const [bulkAssignQuery, setBulkAssignQuery] = useState("");
  const [bulkToast, setBulkToast] = useState<string | null>(null);
  const [bulkFailures, setBulkFailures] = useState<BulkWorkItemResult[]>([]);
  const [columnMenuRect, setColumnMenuRect] = useState<DOMRect | null>(null);
  const [focusCommentRequest, setFocusCommentRequest] = useState(0);
  const [openAssigneeRequest, setOpenAssigneeRequest] = useState(0);
  const [openStateRequest, setOpenStateRequest] = useState(0);
  const [openPriorityRequest, setOpenPriorityRequest] = useState(0);
  const [itemOverrides, setItemOverrides] = useState<Map<string, Partial<WorkItemSummary>>>(new Map());
  const [customPreviewFields, setCustomPreviewFields] = useState<CustomPreviewField[]>(
    () => loadCustomPreviewFields(),
  );
  const [columnFilters, setColumnFilters] = useState<Partial<Record<FilterableColumn, Set<string>>>>(
    () => loadWorkItemColumnFilters(columnFiltersStorageKey),
  );
  const [openFilterCol, setOpenFilterCol] = useState<FilterableColumn | null>(null);
  const [filterAnchorRect, setFilterAnchorRect] = useState<DOMRect | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const gridHadFocusRef = useRef(false);
  const previousResultKeysRef = useRef<string | null>(null);
  const [gridViewport, setGridViewport] = useState({ height: 0, scrollTop: 0 });
  const queryClient = useQueryClient();

  useEffect(() => {
    setWiSort(initialSort ?? loadWorkItemSort(sortStorageKey, defaultWorkItemSort()));
  }, [initialSort?.direction, initialSort?.key, sortStorageKey]);

  useEffect(() => {
    setColumnWidths(
      storedNumbers(columnWidthsStorageKey, DEFAULT_WI_COLUMN_WIDTHS, WI_COLUMN_MIN_WIDTHS, WI_COLUMN_MAX_WIDTHS),
    );
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
  }, [columnFiltersStorageKey, columnWidthsStorageKey, previewWidthStorageKey, visibleColumnsStorageKey]);

  useEffect(() => {
    localStorage.setItem(columnWidthsStorageKey, JSON.stringify(columnWidths));
  }, [columnWidths, columnWidthsStorageKey]);

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

  // Local "done" triage (only on views that pass a triageScope).
  const [showDone, setShowDone] = useState(false);
  const [triageVersion, setTriageVersion] = useState(0);
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

  const displayed = useMemo(() => {
    const hasFilters = (Object.values(columnFilters) as (Set<string> | undefined)[]).some(v => v && v.size > 0);
    if (!hasFilters) return sorted;
    return sorted.filter(item => {
      for (const col of Object.keys(columnFilters) as FilterableColumn[]) {
        const activeValues = columnFilters[col];
        if (!activeValues || activeValues.size === 0) continue;
        if (!activeValues.has(FILTERABLE_COLUMNS[col](item))) return false;
      }
      return true;
    });
  }, [sorted, columnFilters]);

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
  const bulkStateType = useMemo(() => {
    const types = new Set(checkedItems.map((item) => item.workItemType).filter(Boolean));
    return types.size === 1 ? ([...types][0] ?? null) : null;
  }, [checkedItems]);
  const firstCheckedItem = checkedItems[0] ?? null;

  useEffect(() => {
    if (!selectedItem) return;
    recordRecentWorkItem(selectedItem);
  }, [selectedItem]);

  useEffect(() => {
    // Wait for the selection to settle: a preview fetch is several REST calls,
    // and holding an arrow key would otherwise fire a burst of them for rows
    // the user only scrolled past.
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

  const COMMON_STATES = ["New", "Active", "Resolved", "Closed", "To Do", "Doing", "Done"];

  const bulkStatesQuery = useQuery({
    queryKey: workItemQueryKeys.typeStates(
      firstCheckedItem?.organizationId,
      firstCheckedItem?.projectId,
      bulkStateType,
    ),
    queryFn: () =>
      listWorkItemTypeStates({
        organizationId: firstCheckedItem?.organizationId,
        projectId: firstCheckedItem?.projectId ?? "",
        workItemType: bulkStateType ?? "",
      }),
    enabled: bulkStateOpen && !!bulkStateType && !!firstCheckedItem,
    staleTime: Infinity,
  });
  const bulkStateOptions = bulkStateType && bulkStatesQuery.data ? bulkStatesQuery.data : COMMON_STATES;

  const debouncedBulkAssignQuery = useDebouncedValue(bulkAssignQuery, 200);
  const bulkAssigneesQuery = useQuery({
    queryKey: workItemQueryKeys.assignees(
      firstCheckedItem?.organizationId,
      firstCheckedItem?.projectId,
      firstCheckedItem?.id,
      debouncedBulkAssignQuery,
    ),
    queryFn: () =>
      searchWorkItemAssignees({
        organizationId: firstCheckedItem!.organizationId,
        projectId: firstCheckedItem!.projectId,
        workItemId: firstCheckedItem!.id,
        query: debouncedBulkAssignQuery,
      }),
    enabled:
      bulkAssignOpen && !!firstCheckedItem && debouncedBulkAssignQuery.trim().length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const bulkDefaultAssigneesQuery = useQuery({
    queryKey: workItemQueryKeys.assignees(
      firstCheckedItem?.organizationId,
      firstCheckedItem?.projectId,
      firstCheckedItem?.id,
      "",
    ),
    queryFn: () =>
      searchWorkItemAssignees({
        organizationId: firstCheckedItem!.organizationId,
        projectId: firstCheckedItem!.projectId,
        workItemId: firstCheckedItem!.id,
        query: "",
      }),
    enabled: bulkAssignOpen && !!firstCheckedItem,
    staleTime: 60_000,
  });
  const bulkAssignOptions = bulkAssignQuery.trim()
    ? (bulkAssigneesQuery.data ?? [])
    : (bulkDefaultAssigneesQuery.data ?? []);
  const bulkAssignLoading = bulkAssignQuery.trim()
    ? bulkAssigneesQuery.isLoading
    : bulkDefaultAssigneesQuery.isLoading;

  function showBulkToast(results: BulkWorkItemResult[]) {
    const failed = results.filter((r) => r.error).length;
    const succeeded = results.length - failed;
    setBulkFailures(results.filter((r) => r.error));
    const msg =
      failed === 0
        ? `${succeeded} item${succeeded === 1 ? "" : "s"} updated`
        : `${succeeded} updated, ${failed} failed`;
    setBulkToast(msg);
    window.setTimeout(() => setBulkToast(null), 3000);
  }

  const bulkStateMutation = useMutation({
    mutationFn: async (state: string) => {
      const groups = new Map<string, typeof checkedItems>();
      for (const item of checkedItems) {
        const key = `${item.organizationId}:${item.projectId}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }
      const allResults: BulkWorkItemResult[] = [];
      for (const [, items] of groups) {
        const r = await setWorkItemsState({
          organizationId: items[0].organizationId,
          projectId: items[0].projectId,
          workItemIds: items.map((i) => i.id),
          state,
        });
        allResults.push(...r);
      }
      return allResults;
    },
    onSuccess: (results) => {
      setBulkStateOpen(false);
      setCheckedIds(new Set());
      setLastCheckedIndex(null);
      showBulkToast(results);
      invalidateWorkItemMutationCaches(queryClient);
    },
    onError: (e) => {
      setBulkToast(commandErrorMessage(e));
      window.setTimeout(() => setBulkToast(null), 3000);
    },
  });

  const bulkAssignMutation = useMutation({
    mutationFn: async (candidate: WorkItemAssigneeCandidate) => {
      const groups = new Map<string, typeof checkedItems>();
      for (const item of checkedItems) {
        const key = `${item.organizationId}:${item.projectId}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }
      const allResults: BulkWorkItemResult[] = [];
      for (const [, items] of groups) {
        const r = await assignWorkItems({
          organizationId: items[0].organizationId,
          projectId: items[0].projectId,
          workItemIds: items.map((i) => i.id),
          assignedTo: candidate.assignValue,
        });
        allResults.push(...r);
      }
      return allResults;
    },
    onSuccess: (results, candidate) => {
      const succeededIds = new Set(results.filter((result) => !result.error).map((result) => result.id));
      if (succeededIds.size > 0 && candidate.uniqueName) {
        const organizationIds = new Set(
          checkedItems
            .filter((item) => succeededIds.has(item.id))
            .map((item) => item.organizationId),
        );
        for (const organizationId of organizationIds) {
          void recordAssigneeInteraction({
            organizationId,
            userId: candidate.id,
            displayName: candidate.displayName,
            uniqueName: candidate.uniqueName,
          }).catch(() => {
            // History is best-effort; the assignment itself already succeeded.
          });
        }
      }
      if (succeededIds.size > 0) {
        setItemOverrides((current) => {
          const next = new Map(current);
          for (const item of checkedItems) {
            if (!succeededIds.has(item.id)) continue;
            const key = workItemSummaryKey(item);
            next.set(key, {
              ...(next.get(key) ?? {}),
              assignedTo: candidate.displayName,
            });
          }
          return next;
        });
      }
      setBulkAssignOpen(false);
      setBulkAssignQuery("");
      setCheckedIds(new Set());
      setLastCheckedIndex(null);
      showBulkToast(results);
      invalidateWorkItemMutationCaches(queryClient);
    },
    onError: (e) => {
      setBulkToast(commandErrorMessage(e));
      window.setTimeout(() => setBulkToast(null), 3000);
    },
  });

  const bulkPriorityMutation = useMutation({
    mutationFn: async (priority: number) => {
      const groups = new Map<string, typeof checkedItems>();
      for (const item of checkedItems) {
        const key = `${item.organizationId}:${item.projectId}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }
      const allResults: BulkWorkItemResult[] = [];
      for (const [, items] of groups) {
        const r = await setWorkItemsPriority({
          organizationId: items[0].organizationId,
          projectId: items[0].projectId,
          workItemIds: items.map((i) => i.id),
          priority,
        });
        allResults.push(...r);
      }
      return allResults;
    },
    onSuccess: (results) => {
      setBulkPriorityOpen(false);
      setCheckedIds(new Set());
      setLastCheckedIndex(null);
      showBulkToast(results);
      invalidateWorkItemMutationCaches(queryClient);
    },
    onError: (e) => {
      setBulkToast(commandErrorMessage(e));
      window.setTimeout(() => setBulkToast(null), 3000);
    },
  });

  useEffect(() => {
    if (autoFocus) containerRef.current?.focus();
  }, [autoFocus]);

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
  }, [displayed, displayed.length, selectedItemKey]);

  useEffect(() => {
    const scroller = gridScrollRef.current;
    if (!scroller) return;
    const scrollerElement = scroller;

    function updateViewport() {
      setGridViewport({
        height: scrollerElement.clientHeight,
        scrollTop: scrollerElement.scrollTop,
      });
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
  }, []);

  useEffect(() => {
    const previous = previousResultKeysRef.current;
    previousResultKeysRef.current = resultKeysSignature;
    if (previous === null || previous === resultKeysSignature) return;
    setItemOverrides(new Map());
    setCheckedIds(new Set());
    setLastCheckedIndex(null);
    setOpenFilterCol(null);
  }, [resultKeysSignature]);

  useEffect(() => {
    if (!gridHadFocusRef.current) return;
    window.setTimeout(() => {
      rowRefs.current[selectedIndex]?.focus();
    }, 0);
  }, [selectedIndex, resultKeysSignature]);

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
    setColumnFilters(prev => {
      const current = prev[col];
      if (!current || current.size === 0) {
        const next = new Set(allValues.filter(v => v !== value));
        if (next.size === 0) return prev;
        return { ...prev, [col]: next };
      }
      const next = new Set(current);
      if (next.has(value)) {
        next.delete(value);
        if (next.size === 0) {
          const { [col]: _, ...rest } = prev;
          return rest;
        }
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
    setColumnFilters(prev => {
      const { [col]: _, ...rest } = prev;
      return rest;
    });
  }

  function clearAllFilters() {
    setColumnFilters({});
    setOpenFilterCol(null);
    setFilterAnchorRect(null);
    onClearExternalFilters?.();
    setSelectedIndex(0);
  }

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

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.defaultPrevented) return;
    if (isEditableTarget(e.target)) {
      if (e.key === "Escape") {
        e.preventDefault();
        moveSelection(selectedIndex);
      }
      return;
    }
    if (e.key === "Escape") {
      if (openFilterCol) {
        setOpenFilterCol(null);
        setFilterAnchorRect(null);
        return;
      }
      setBulkAssignOpen(false);
      setBulkStateOpen(false);
      setBulkPriorityOpen(false);
      setColumnMenuRect(null);
      return;
    }
    // Single-letter shortcuts must not swallow app-level chords such as
    // Ctrl+K (palette) or Ctrl+S (apply staged changes).
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === "Enter" && displayed.length > 0) {
        e.preventDefault();
        const item = displayed[selectedIndex];
        if (item?.webUrl) openExternalUrl(item.webUrl);
      }
      return;
    }
    if (displayed.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
      e.preventDefault();
      moveSelection(selectedIndex + 1);
    } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
      e.preventDefault();
      moveSelection(selectedIndex - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveSelection(0);
    } else if (e.key === "End") {
      e.preventDefault();
      moveSelection(displayed.length - 1);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      moveSelection(selectedIndex + 10);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      moveSelection(selectedIndex - 10);
    } else if (e.key === "Enter") {
      e.preventDefault();
      focusPrimaryPreview();
    } else if (e.key === "o" || e.key === "O") {
      e.preventDefault();
      const item = displayed[selectedIndex];
      if (item?.webUrl) openExternalUrl(item.webUrl);
    } else if (e.key === "c" || e.key === "C") {
      const item = displayed[selectedIndex];
      if (item?.webUrl) {
        void navigator.clipboard.writeText(item.webUrl).then(() => {
          setCopyToast("URL copied");
          window.setTimeout(() => setCopyToast(null), 2000);
        });
      }
    } else if (e.key === " ") {
      e.preventDefault();
      const item = displayed[selectedIndex];
      if (item) {
        const key = `${item.organizationId}:${item.projectId}:${item.id}`;
        handleCheckboxChange(selectedIndex, !checkedIds.has(key), false);
      }
    } else if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      setFocusCommentRequest((value) => value + 1);
    } else if (e.key === "u" || e.key === "U") {
      window.dispatchEvent(new CustomEvent("azdodeck:work-items:undo-apply"));
    } else if ((e.key === "e" || e.key === "E") && triageScope) {
      e.preventDefault();
      const item = displayed[selectedIndex];
      if (item) {
        toggleTriageArchived(
          triageScope,
          workItemSummaryKey(item),
          workItemTriageSnapshot(item),
        );
        setTriageVersion((value) => value + 1);
      }
    } else if (e.key === "a" || e.key === "A") {
      e.preventDefault();
      if (checkedItems.length > 0) {
        setBulkStateOpen(false);
        setBulkPriorityOpen(false);
        setBulkAssignOpen(true);
      } else {
        setOpenAssigneeRequest((value) => value + 1);
      }
    } else if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      if (checkedItems.length > 0) {
        setBulkAssignOpen(false);
        setBulkPriorityOpen(false);
        setBulkStateOpen(true);
      } else {
        setOpenStateRequest((value) => value + 1);
      }
    } else if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      if (checkedItems.length > 0) {
        setBulkAssignOpen(false);
        setBulkStateOpen(false);
        setBulkPriorityOpen(true);
      } else {
        setOpenPriorityRequest((value) => value + 1);
      }
    }
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
    setColumnWidths([...DEFAULT_WI_COLUMN_WIDTHS]);
  }

  const visibleColumnWidths = visibleColumns.map(
    (column) => columnWidths[WI_GRID_KEYS.indexOf(column)],
  );
  const wiFlexibleIndex = Math.max(0, visibleColumns.indexOf("title"));
  const wiColTemplate = [
    gridColumnTemplate(visibleColumnWidths, wiFlexibleIndex, ["28px"]),
    ...extraColumns.map(() => "120px"),
  ].join(" ");
  const columnFilterCount = activeColumnFilterCount(columnFilters);
  const activeFilterCount = Math.max(0, activeExternalFilterCount) + columnFilterCount;
  const hasActiveColumnFilters = columnFilterCount > 0;
  const hasActiveFilters = activeFilterCount > 0;
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
  const virtualBottomPadding =
    Math.max(0, displayed.length - lastVirtualRow) * WI_GRID_ROW_HEIGHT;

  return (
    <div
      ref={containerRef}
      className="flex min-h-0 flex-1 flex-col outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onFocusCapture={(event) => {
        const target = event.target;
        gridHadFocusRef.current =
          target instanceof HTMLElement &&
          Boolean(target.closest('[role="grid"], [role="row"]'));
      }}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (
          !(nextTarget instanceof HTMLElement) ||
          !nextTarget.closest('[role="grid"], [role="row"]')
        ) {
          gridHadFocusRef.current = false;
        }
      }}
    >
      {copyToast || bulkToast ? (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-3 py-1 text-xs text-background shadow-lg">
          {copyToast ?? bulkToast}
        </div>
      ) : null}
      {checkedItems.length > 0 ? (
        <BulkActionBar
          count={checkedItems.length}
          onClear={() => { setCheckedIds(new Set()); setLastCheckedIndex(null); }}
          stateOpen={bulkStateOpen}
          onStateOpenChange={(open) => {
            setBulkStateOpen(open);
            if (open) {
              setBulkAssignOpen(false);
              setBulkPriorityOpen(false);
            }
          }}
          stateOptions={bulkStateOptions}
          stateLoading={bulkStatesQuery.isFetching}
          statePending={bulkStateMutation.isPending}
          onStateSelect={(state) => bulkStateMutation.mutate(state)}
          assignOpen={bulkAssignOpen}
          onAssignOpenChange={(open) => {
            setBulkAssignOpen(open);
            if (!open) setBulkAssignQuery("");
            if (open) {
              setBulkStateOpen(false);
              setBulkPriorityOpen(false);
            }
          }}
          assignQuery={bulkAssignQuery}
          onAssignQueryChange={setBulkAssignQuery}
          assignOptions={bulkAssignOptions}
          assignLoading={bulkAssignLoading}
          assignPending={bulkAssignMutation.isPending}
          onAssignSelect={(candidate) => bulkAssignMutation.mutate(candidate)}
          priorityOpen={bulkPriorityOpen}
          onPriorityOpenChange={(open) => {
            setBulkPriorityOpen(open);
            if (open) {
              setBulkStateOpen(false);
              setBulkAssignOpen(false);
            }
          }}
          priorityPending={bulkPriorityMutation.isPending}
          onPrioritySelect={(priority) => bulkPriorityMutation.mutate(priority)}
        />
      ) : null}
      {bulkFailures.length > 0 ? (
        <BulkFailurePanel
          failures={bulkFailures}
          onDismiss={() => setBulkFailures([])}
        />
      ) : null}
      <div
        className={`grid min-h-0 flex-1 items-stretch gap-3 ${
          previewVisible
            ? "xl:grid-cols-[minmax(0,1fr)_8px_minmax(300px,var(--work-item-preview-width))]"
            : "xl:grid-cols-[minmax(0,1fr)]"
        }`}
        style={{ "--work-item-preview-width": `${previewWidth}px` } as CSSProperties}
      >
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-white">
          <div ref={gridScrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div className="min-w-[520px]">
              <div
                role="row"
                className="grid items-center gap-2 border-b border-border bg-gray-50 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                style={{ gridTemplateColumns: wiColTemplate }}
              >
                <div role="columnheader" className="flex items-center justify-center">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={displayed.length > 0 && displayed.every((item) => checkedIds.has(`${item.organizationId}:${item.projectId}:${item.id}`))}
                    ref={(el) => {
                      if (el) {
                        const some = displayed.some((item) => checkedIds.has(`${item.organizationId}:${item.projectId}:${item.id}`));
                        const all = displayed.length > 0 && displayed.every((item) => checkedIds.has(`${item.organizationId}:${item.projectId}:${item.id}`));
                        el.indeterminate = some && !all;
                      }
                    }}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setCheckedIds(new Set(displayed.map((item) => `${item.organizationId}:${item.projectId}:${item.id}`)));
                      } else {
                        setCheckedIds(new Set());
                      }
                      setLastCheckedIndex(null);
                    }}
                    className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300"
                  />
                </div>
                {visibleColumns.map((col, i) => (
                  <WiSortHeaderButton
                    key={col}
                    column={col}
                    sort={sort}
                    onSort={applyWiSort}
                    filterActive={isFilterableColumn(col) && !!(columnFilters[col]?.size)}
                    onFilterOpen={isFilterableColumn(col) ? (el) => openFilter(col, el) : undefined}
                    resizeHandle={
                      i < visibleColumns.length - 1 ? (
                        <ColumnResizeHandle
                          columnIndex={WI_GRID_KEYS.indexOf(col)}
                          widths={columnWidths}
                          setWidths={setColumnWidths}
                          min={WI_COLUMN_MIN_WIDTHS[WI_GRID_KEYS.indexOf(col)]}
                          max={WI_COLUMN_MAX_WIDTHS[WI_GRID_KEYS.indexOf(col)]}
                        />
                      ) : undefined
                    }
                  />
                ))}
                {extraColumns.map((referenceName) => (
                  <div
                    key={referenceName}
                    role="columnheader"
                    className="min-w-0 truncate px-1 py-0.5"
                    title={referenceName}
                  >
                    {extraColumnLabel(referenceName)}
                  </div>
                ))}
              </div>

              {showBlockingLoading ? (
                <LoadingState />
              ) : !searched ? (
                <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
                  {emptyMessage ?? "Run a search to load work items."}
                </div>
              ) : sorted.length === 0 ? (
                <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
                  No work items matched.
                </div>
              ) : displayed.length === 0 ? (
                <div className="flex min-h-24 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                  <span>No items match the active filters.</span>
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="rounded border border-border px-2 py-0.5 text-xs hover:bg-secondary"
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <div
                  role="grid"
                  aria-label="Work items"
                  data-primary-grid="true"
                  tabIndex={-1}
                >
                  {virtualTopPadding > 0 ? (
                    <div style={{ height: virtualTopPadding }} />
                  ) : null}
                  {virtualRows.map((item, offset) => {
                    const i = firstVirtualRow + offset;
                    return (
                      <WorkItemGridRow
                        key={`${item.organizationId}:${item.projectId}:${item.id}`}
                        ref={(el) => {
                          rowRefs.current[i] = el;
                        }}
                        item={item}
                        selected={i === selectedIndex}
                        checked={checkedIds.has(`${item.organizationId}:${item.projectId}:${item.id}`)}
                        columnTemplate={wiColTemplate}
                        visibleColumns={visibleColumns}
                        extraColumns={extraColumns}
                        onSelect={() => setSelectedIndex(i)}
                        onCheckedChange={(checked, shiftKey) => handleCheckboxChange(i, checked, shiftKey)}
                      />
                    );
                  })}
                  {virtualBottomPadding > 0 ? (
                    <div style={{ height: virtualBottomPadding }} />
                  ) : null}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1 text-xs text-muted-foreground">
            <span>
              {loading
                ? "Loading…"
                : searched
                  ? hasActiveColumnFilters
                    ? `${displayed.length} of ${sorted.length} item${sorted.length === 1 ? "" : "s"}`
                    : `${displayed.length} item${displayed.length === 1 ? "" : "s"}`
                  : "Ready"}
              {dataUpdatedAt ? ` · data ${formatRelativeDate(new Date(dataUpdatedAt).toISOString())}` : ""}
            </span>
            <span className="flex items-center gap-2">
              {triageScope ? (
                <button
                  type="button"
                  aria-pressed={showDone}
                  title="Toggle done view (E marks the selected row done)"
                  onClick={() => {
                    setShowDone((value) => !value);
                    setSelectedIndex(0);
                  }}
                  className={`rounded border px-2 py-0.5 text-xs ${
                    showDone
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-white hover:bg-secondary"
                  }`}
                >
                  {showDone ? "Back to inbox" : `Done (${archivedKeys.size})`}
                </button>
              ) : null}
              {hasActiveFilters ? (
                <>
                  <span>{activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active</span>
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="rounded border border-border bg-white px-2 py-0.5 text-xs hover:bg-secondary"
                  >
                    Clear filters
                  </button>
                </>
              ) : null}
              <button
                type="button"
                onClick={(event) => setColumnMenuRect(event.currentTarget.getBoundingClientRect())}
                className="rounded border border-border bg-white px-2 py-0.5 text-xs hover:bg-secondary"
              >
                Columns
              </button>
              <ShortcutHint>Alt+G</ShortcutHint>
            </span>
          </div>
        </div>

        {previewVisible ? (
          <>
            <ResizeHandle
              ariaLabel="Resize work item preview"
              className="hidden xl:flex"
              direction={-1}
              max={MAX_WORK_ITEM_PREVIEW_WIDTH}
              min={300}
              onChange={setPreviewWidth}
              onReset={() => setPreviewWidth(DEFAULT_WORK_ITEM_PREVIEW_WIDTH)}
              value={previewWidth}
            />

            <WorkItemPreviewPanel
              customPreviewFields={customPreviewFields}
              focusCommentRequest={focusCommentRequest}
              onCustomPreviewFieldsChange={(fields) => {
                storeCustomPreviewFields(fields);
                setCustomPreviewFields(fields);
              }}
              openAssigneeRequest={openAssigneeRequest}
              openPriorityRequest={openPriorityRequest}
              openStateRequest={openStateRequest}
              preview={previewQuery.data ?? null}
              previewError={previewQuery.isError ? commandErrorMessage(previewQuery.error) : null}
              previewLoading={previewQuery.isFetching}
              selectedItem={selectedItem}
              onPreviewUpdated={handlePreviewUpdated}
            />
          </>
        ) : null}
      </div>
      {openFilterCol && filterAnchorRect ? (
        <ColumnFilterDropdown
          anchorRect={filterAnchorRect}
          allValues={columnUniqueValues[openFilterCol] ?? []}
          activeValues={columnFilters[openFilterCol]}
          onToggle={(value) => toggleFilter(openFilterCol, value)}
          onClearAll={() => clearColumnFilter(openFilterCol)}
          onClose={() => { setOpenFilterCol(null); setFilterAnchorRect(null); }}
        />
      ) : null}
      {columnMenuRect ? (
        <ColumnVisibilityDropdown
          anchorRect={columnMenuRect}
          visibleColumns={visibleColumns}
          onToggle={toggleColumnVisibility}
          onReset={resetColumnVisibility}
          onClose={() => setColumnMenuRect(null)}
        />
      ) : null}
    </div>
  );
}

function ColumnFilterDropdown({
  anchorRect,
  allValues,
  activeValues,
  onToggle,
  onClearAll,
  onClose,
}: {
  anchorRect: DOMRect;
  allValues: string[];
  activeValues: Set<string> | undefined;
  onToggle: (value: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!dropdownRef.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const isAllChecked = !activeValues || activeValues.size === 0;
  const filteredValues = search.trim()
    ? allValues.filter(v => v.toLowerCase().includes(search.trim().toLowerCase()))
    : allValues;

  const top = Math.min(anchorRect.bottom + 2, window.innerHeight - 280);
  const left = Math.min(anchorRect.left, window.innerWidth - 208);

  return (
    <div
      ref={dropdownRef}
      className="fixed z-50 w-52 rounded-md border border-border bg-white shadow-lg"
      style={{ top, left }}
    >
      <div className="border-b border-border p-1.5">
        <input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search…"
          className="w-full rounded border border-input bg-background px-2 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="border-b border-border p-1">
        <button
          type="button"
          onClick={onClearAll}
          className={`w-full rounded px-2 py-0.5 text-left text-xs hover:bg-secondary ${
            isAllChecked ? "font-medium text-foreground" : "text-muted-foreground"
          }`}
        >
          (All)
        </button>
      </div>
      <div className="max-h-44 overflow-auto p-1">
        {filteredValues.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">No values</p>
        ) : (
          filteredValues.map(value => {
            const checked = isAllChecked || (activeValues?.has(value) ?? false);
            return (
              <label
                key={value}
                className="flex cursor-pointer select-none items-center gap-1.5 rounded px-2 py-0.5 text-xs hover:bg-secondary"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(value)}
                  className="h-3 w-3"
                />
                <span className="truncate">{value || "(empty)"}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

function ColumnVisibilityDropdown({
  anchorRect,
  visibleColumns,
  onToggle,
  onReset,
  onClose,
}: {
  anchorRect: DOMRect;
  visibleColumns: WiSortKey[];
  onToggle: (column: WiSortKey) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!dropdownRef.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const top = Math.min(anchorRect.bottom + 2, window.innerHeight - 300);
  const left = Math.min(anchorRect.left, window.innerWidth - 224);

  return (
    <div
      ref={dropdownRef}
      className="fixed z-50 w-56 rounded-md border border-border bg-white p-1 shadow-lg"
      style={{ top, left }}
    >
      <div className="border-b border-border px-2 py-1.5 text-xs font-semibold text-foreground">
        Visible columns
      </div>
      <div className="py-1">
        {WI_GRID_KEYS.map((column) => {
          const required = WI_GRID_REQUIRED_COLUMNS.includes(column);
          return (
            <label
              key={column}
              className="flex cursor-pointer select-none items-center justify-between gap-2 rounded px-2 py-1 text-xs hover:bg-secondary"
            >
              <span>{wiSortLabels[column]}</span>
              <input
                type="checkbox"
                checked={visibleColumns.includes(column)}
                disabled={required}
                onChange={() => onToggle(column)}
                className="h-3 w-3"
              />
            </label>
          );
        })}
      </div>
      <div className="border-t border-border p-1">
        <button
          type="button"
          onClick={onReset}
          className="w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          Reset columns
        </button>
      </div>
    </div>
  );
}

function BulkFailurePanel({
  failures,
  onDismiss,
}: {
  failures: BulkWorkItemResult[];
  onDismiss: () => void;
}) {
  return (
    <div className="mb-2 rounded-md border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          {failures.length} bulk update failure{failures.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded px-1 text-destructive hover:bg-red-100"
        >
          Dismiss
        </button>
      </div>
      <ul className="mt-1 max-h-24 overflow-auto">
        {failures.map((failure) => (
          <li key={failure.id} className="truncate">
            #{failure.id}: {failure.error}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BulkActionBar({
  count,
  onClear,
  stateOpen,
  onStateOpenChange,
  stateOptions,
  stateLoading,
  statePending,
  onStateSelect,
  assignOpen,
  onAssignOpenChange,
  assignQuery,
  onAssignQueryChange,
  assignOptions,
  assignLoading,
  assignPending,
  onAssignSelect,
  priorityOpen,
  onPriorityOpenChange,
  priorityPending,
  onPrioritySelect,
}: {
  count: number;
  onClear: () => void;
  stateOpen: boolean;
  onStateOpenChange: (open: boolean) => void;
  stateOptions: string[];
  stateLoading: boolean;
  statePending: boolean;
  onStateSelect: (state: string) => void;
  assignOpen: boolean;
  onAssignOpenChange: (open: boolean) => void;
  assignQuery: string;
  onAssignQueryChange: (q: string) => void;
  assignOptions: WorkItemAssigneeCandidate[];
  assignLoading: boolean;
  assignPending: boolean;
  onAssignSelect: (candidate: WorkItemAssigneeCandidate) => void;
  priorityOpen: boolean;
  onPriorityOpenChange: (open: boolean) => void;
  priorityPending: boolean;
  onPrioritySelect: (priority: number) => void;
}) {
  const stateListRef = useRef<HTMLDivElement>(null);
  const priorityListRef = useRef<HTMLDivElement>(null);
  const assignInputRef = useRef<HTMLInputElement>(null);
  const assignListRef = useRef<HTMLDivElement>(null);

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5">
      <span className="text-xs font-medium text-foreground">
        {count} item{count === 1 ? "" : "s"} selected
      </span>
      <div className="flex items-center gap-1.5">
        {/* State picker */}
        <div className="relative">
          <button
            type="button"
            disabled={statePending}
            onClick={() => onStateOpenChange(!stateOpen)}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-white px-2.5 text-xs font-medium hover:bg-secondary disabled:opacity-60"
          >
            {statePending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
            State
            <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          </button>
          {stateOpen ? (
            <div ref={stateListRef} className="absolute left-0 top-full z-30 mt-1 min-w-[130px] rounded-md border border-border bg-white py-1 shadow-lg">
              {stateLoading ? (
                <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Loading…
                </div>
              ) : (
                stateOptions.map((s, index) => (
                  <button
                    key={s}
                    type="button"
                    autoFocus={index === 0}
                    onClick={() => { onStateSelect(s); onStateOpenChange(false); }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") onStateOpenChange(false);
                      else if (e.key === "Enter") { e.stopPropagation(); }
                      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        const buttons = Array.from(stateListRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
                        const i = buttons.indexOf(e.currentTarget);
                        if (e.key === "ArrowDown") buttons[i + 1]?.focus();
                        else if (i > 0) buttons[i - 1].focus();
                      }
                    }}
                    className="flex w-full items-center px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {s}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
        {/* Assignee picker */}
        <div className="relative">
          <button
            type="button"
            disabled={assignPending}
            onClick={() => onAssignOpenChange(!assignOpen)}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-white px-2.5 text-xs font-medium hover:bg-secondary disabled:opacity-60"
          >
            {assignPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
            Assignee
            <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          </button>
          {assignOpen ? (
            <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-md border border-border bg-white p-1 shadow-lg">
              <input
                ref={assignInputRef}
                autoFocus
                value={assignQuery}
                onChange={(e) => onAssignQueryChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") onAssignOpenChange(false);
                  else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    assignListRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
                  }
                }}
                placeholder="Search assignee..."
                className="mb-1 h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
              />
              <div ref={assignListRef} className="max-h-44 overflow-auto">
                {assignLoading ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">Searching…</div>
                ) : assignOptions.length > 0 ? (
                  assignOptions.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onAssignSelect(c)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") onAssignOpenChange(false);
                        else if (e.key === "Enter") { e.stopPropagation(); }
                        else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                          e.preventDefault();
                          const buttons = Array.from(assignListRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
                          const i = buttons.indexOf(e.currentTarget);
                          if (e.key === "ArrowDown") buttons[i + 1]?.focus();
                          else if (i > 0) buttons[i - 1].focus();
                          else assignInputRef.current?.focus();
                        }
                      }}
                      className="flex w-full min-w-0 flex-col rounded px-2 py-1 text-left text-xs hover:bg-secondary"
                    >
                      <span className="truncate font-medium">{c.displayName}</span>
                      {c.uniqueName ? (
                        <span className="truncate text-[11px] text-muted-foreground">{c.uniqueName}</span>
                      ) : null}
                    </button>
                  ))
                ) : (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    {assignQuery.trim() ? "No matches" : "No recent assignees"}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
        <div className="relative">
          <button
            type="button"
            disabled={priorityPending}
            onClick={() => onPriorityOpenChange(!priorityOpen)}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-white px-2.5 text-xs font-medium hover:bg-secondary disabled:opacity-60"
          >
            {priorityPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
            Priority
            <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          </button>
          {priorityOpen ? (
            <div ref={priorityListRef} className="absolute left-0 top-full z-30 mt-1 min-w-[96px] rounded-md border border-border bg-white py-1 shadow-lg">
              {[1, 2, 3, 4].map((priority, index) => (
                <button
                  key={priority}
                  type="button"
                  autoFocus={index === 0}
                  onClick={() => {
                    onPrioritySelect(priority);
                    onPriorityOpenChange(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") onPriorityOpenChange(false);
                    else if (e.key === "Enter") { e.stopPropagation(); }
                    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      const buttons = Array.from(priorityListRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
                      const i = buttons.indexOf(e.currentTarget);
                      if (e.key === "ArrowDown") buttons[i + 1]?.focus();
                      else if (i > 0) buttons[i - 1].focus();
                    }
                  }}
                  className="flex w-full items-center px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {priority}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground"
        aria-label="Clear selection"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
