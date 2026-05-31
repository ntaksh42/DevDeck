import {
  type CSSProperties,
  type ReactNode,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';
import {
  setWorkItemsState,
  assignWorkItems,
  listWorkItemTypeStates,
  searchWorkItemMentions,
  getWorkItemPreview,
  commandErrorMessage,
  type BulkWorkItemResult,
  type MentionCandidate,
  type WorkItemSummary,
} from '@/lib/azdoCommands';
import {
  storedNumbers,
  storedNumber,
  isEditableTarget,
  focusPrimaryPreview,
  formatRelativeDate,
  type SortDirection,
} from '@/lib/utils';
import { openExternalUrl } from '@/lib/openExternal';
import { ShortcutHint } from '@/components/ShortcutHint';
import { ColumnResizeHandle, ResizeHandle } from '@/components/ResizeHandle';
import { LoadingState } from '@/components/StateDisplay';
import { WorkItemPreviewPanel } from './WorkItemPreviewPanel';
import { invalidateWorkItemMutationCaches, workItemQueryKeys } from './queryKeys';
const DEFAULT_WI_COLUMN_WIDTHS = [60, 100, 80, 280, 130, 120, 90];
const WI_COLUMN_MIN_WIDTHS = [56, 90, 80, 200, 120, 100, 80];
const WI_COLUMN_MAX_WIDTHS = [120, 200, 180, 720, 300, 260, 160];
const WI_COLUMN_WIDTHS_STORAGE_KEY = "azdodeck:layout:wiSearchGridColumnWidths";
const DEFAULT_WORK_ITEM_PREVIEW_WIDTH = 440;
const WORK_ITEM_PREVIEW_WIDTH_STORAGE_KEY = "azdodeck:layout:workItemPreviewWidth";
type WiSortKey =
  | "id"
  | "workItemType"
  | "state"
  | "title"
  | "projectName"
  | "assignedTo"
  | "changedDate";
type WiSortState = { key: WiSortKey; direction: SortDirection };

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
}: {
  column: WiSortKey;
  sort: WiSortState;
  onSort: (column: WiSortKey) => void;
  resizeHandle?: ReactNode;
}) {
  const active = sort.key === column;
  const label = wiSortLabels[column];
  return (
    <div
      role="columnheader"
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className="relative min-w-0"
    >
      <button
        type="button"
        aria-label={`Sort by ${label}`}
        onClick={() => onSort(column)}
        className={`flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring ${
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

const WorkItemGridRow = forwardRef<
  HTMLDivElement,
  {
    item: WorkItemSummary;
    selected: boolean;
    checked: boolean;
    columnTemplate: string;
    onSelect: () => void;
    onCheckedChange: (checked: boolean, shiftKey: boolean) => void;
  }
>(({ item, selected, checked, columnTemplate, onSelect, onCheckedChange }, ref) => (
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
        focusPrimaryPreview();
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
        onChange={(e) => onCheckedChange(e.target.checked, e.nativeEvent instanceof MouseEvent ? (e.nativeEvent as MouseEvent).shiftKey : false)}
        onClick={(e) => e.stopPropagation()}
        className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300"
      />
    </div>
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
    <span className="truncate text-xs text-muted-foreground" title={item.workItemType ?? undefined}>
      {item.workItemType ?? "—"}
    </span>
    <span className="truncate text-xs" title={item.state ?? undefined}>
      {item.state ?? "—"}
    </span>
    <span className="truncate font-medium text-foreground" title={item.title}>
      {item.title}
    </span>
    <span className="truncate text-xs text-muted-foreground" title={item.projectName}>
      {item.projectName}
    </span>
    <span
      className="truncate text-xs text-muted-foreground"
      title={item.assignedTo ?? "Unassigned"}
    >
      {item.assignedTo ?? "—"}
    </span>
    <span
      className="text-xs text-muted-foreground"
      title={item.changedDate ? new Date(item.changedDate).toLocaleString() : undefined}
    >
      {item.changedDate ? formatRelativeDate(item.changedDate) : "—"}
    </span>
  </div>
));
WorkItemGridRow.displayName = "WorkItemGridRow";

export function WorkItemsGrid({
  results,
  loading,
  searched,
  autoFocus = false,
  emptyMessage,
}: {
  results: WorkItemSummary[];
  loading: boolean;
  searched: boolean;
  autoFocus?: boolean;
  emptyMessage?: string;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sort, setWiSort] = useState<WiSortState>({ key: "changedDate", direction: "desc" });
  const [columnWidths, setColumnWidths] = useState(() =>
    storedNumbers(WI_COLUMN_WIDTHS_STORAGE_KEY, DEFAULT_WI_COLUMN_WIDTHS, WI_COLUMN_MIN_WIDTHS, WI_COLUMN_MAX_WIDTHS),
  );
  const [previewWidth, setPreviewWidth] = useState(() =>
    storedNumber(
      WORK_ITEM_PREVIEW_WIDTH_STORAGE_KEY,
      DEFAULT_WORK_ITEM_PREVIEW_WIDTH,
      300,
      860,
    ),
  );
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [lastCheckedIndex, setLastCheckedIndex] = useState<number | null>(null);
  const [bulkStateOpen, setBulkStateOpen] = useState(false);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkAssignQuery, setBulkAssignQuery] = useState("");
  const [bulkToast, setBulkToast] = useState<string | null>(null);
  const [focusCommentRequest, setFocusCommentRequest] = useState(0);
  const [openAssigneeRequest, setOpenAssigneeRequest] = useState(0);
  const [openStateRequest, setOpenStateRequest] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const queryClient = useQueryClient();

  useEffect(() => {
    localStorage.setItem(WI_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    localStorage.setItem(
      WORK_ITEM_PREVIEW_WIDTH_STORAGE_KEY,
      String(Math.round(previewWidth)),
    );
  }, [previewWidth]);

  const sorted = useMemo(
    () =>
      results
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
          const result = compareWorkItems(a.item, b.item, sort.key);
          const directed = sort.direction === "asc" ? result : -result;
          return directed || a.index - b.index;
        })
        .map(({ item }) => item),
    [results, sort],
  );
  const selectedItem = sorted[selectedIndex] ?? null;
  const previewQuery = useQuery({
    queryKey: workItemQueryKeys.preview(
      selectedItem?.organizationId,
      selectedItem?.projectId,
      selectedItem?.id,
    ),
    queryFn: () =>
      getWorkItemPreview({
        organizationId: selectedItem?.organizationId,
        projectId: selectedItem?.projectId ?? "",
        workItemId: selectedItem?.id ?? 0,
      }),
    enabled: !!selectedItem,
    staleTime: 30_000,
  });

  const checkedItems = useMemo(
    () => sorted.filter((item) => checkedIds.has(`${item.organizationId}:${item.projectId}:${item.id}`)),
    [sorted, checkedIds],
  );
  const bulkStateType = useMemo(() => {
    const types = new Set(checkedItems.map((item) => item.workItemType).filter(Boolean));
    return types.size === 1 ? ([...types][0] ?? null) : null;
  }, [checkedItems]);
  const firstCheckedItem = checkedItems[0] ?? null;

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

  const bulkMentionsQuery = useQuery({
    queryKey: workItemQueryKeys.mentions(
      firstCheckedItem?.organizationId,
      bulkAssignQuery,
    ),
    queryFn: () =>
      searchWorkItemMentions({
        organizationId: firstCheckedItem?.organizationId,
        query: bulkAssignQuery,
      }),
    enabled: bulkAssignOpen && !!firstCheckedItem && bulkAssignQuery.trim().length > 0,
    staleTime: 60_000,
  });

  function showBulkToast(results: BulkWorkItemResult[]) {
    const failed = results.filter((r) => r.error).length;
    const succeeded = results.length - failed;
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
  });

  const bulkAssignMutation = useMutation({
    mutationFn: async (assignedTo: string) => {
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
          assignedTo,
        });
        allResults.push(...r);
      }
      return allResults;
    },
    onSuccess: (results) => {
      setBulkAssignOpen(false);
      setBulkAssignQuery("");
      setCheckedIds(new Set());
      setLastCheckedIndex(null);
      showBulkToast(results);
      invalidateWorkItemMutationCaches(queryClient);
    },
  });

  useEffect(() => {
    if (autoFocus) containerRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(sorted.length - 1, 0)));
  }, [sorted.length]);

  useEffect(() => {
    setCheckedIds(new Set());
    setLastCheckedIndex(null);
  }, [results]);

  function moveSelection(index: number) {
    const next = Math.max(0, Math.min(index, sorted.length - 1));
    setSelectedIndex(next);
    rowRefs.current[next]?.focus();
  }

  function handleCheckboxChange(index: number, checked: boolean, shiftKey: boolean) {
    const item = sorted[index];
    if (!item) return;
    const key = `${item.organizationId}:${item.projectId}:${item.id}`;
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastCheckedIndex !== null) {
        const from = Math.min(lastCheckedIndex, index);
        const to = Math.max(lastCheckedIndex, index);
        for (let i = from; i <= to; i++) {
          const it = sorted[i];
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

  function applyWiSort(column: WiSortKey) {
    setWiSort((current) => {
      if (current.key !== column) {
        return { key: column, direction: column === "changedDate" ? "desc" : "asc" };
      }
      return { key: column, direction: current.direction === "asc" ? "desc" : "asc" };
    });
    setSelectedIndex(0);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (isEditableTarget(e.target)) return;
    if (sorted.length === 0) return;
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
      moveSelection(sorted.length - 1);
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
      const item = sorted[selectedIndex];
      if (item?.webUrl) openExternalUrl(item.webUrl);
    } else if (e.key === "c" || e.key === "C") {
      const item = sorted[selectedIndex];
      if (item?.webUrl) {
        void navigator.clipboard.writeText(item.webUrl).then(() => {
          setCopyToast("URL copied");
          window.setTimeout(() => setCopyToast(null), 2000);
        });
      }
    } else if (e.key === " ") {
      e.preventDefault();
      const item = sorted[selectedIndex];
      if (item) {
        const key = `${item.organizationId}:${item.projectId}:${item.id}`;
        handleCheckboxChange(selectedIndex, !checkedIds.has(key), false);
      }
    } else if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      setFocusCommentRequest((value) => value + 1);
    } else if (e.key === "a" || e.key === "A") {
      e.preventDefault();
      if (checkedIds.size > 0) {
        setBulkStateOpen(false);
        setBulkAssignOpen(true);
      } else {
        setOpenAssigneeRequest((value) => value + 1);
      }
    } else if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      if (checkedIds.size > 0) {
        setBulkAssignOpen(false);
        setBulkStateOpen(true);
      } else {
        setOpenStateRequest((value) => value + 1);
      }
    } else if (e.key === "Escape") {
      setBulkAssignOpen(false);
      setBulkStateOpen(false);
    }
  }

  const wiColTemplate = `28px ${columnWidths.map((w) => `${w}px`).join(" ")}`;

  return (
    <div
      ref={containerRef}
      className="flex min-h-0 flex-1 flex-col outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {copyToast || bulkToast ? (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-3 py-1 text-xs text-background shadow-lg">
          {copyToast ?? bulkToast}
        </div>
      ) : null}
      {checkedIds.size > 0 ? (
        <BulkActionBar
          count={checkedIds.size}
          onClear={() => { setCheckedIds(new Set()); setLastCheckedIndex(null); }}
          stateOpen={bulkStateOpen}
          onStateOpenChange={setBulkStateOpen}
          stateOptions={bulkStateOptions}
          stateLoading={bulkStatesQuery.isFetching}
          statePending={bulkStateMutation.isPending}
          onStateSelect={(state) => bulkStateMutation.mutate(state)}
          assignOpen={bulkAssignOpen}
          onAssignOpenChange={(open) => { setBulkAssignOpen(open); if (!open) setBulkAssignQuery(""); }}
          assignQuery={bulkAssignQuery}
          onAssignQueryChange={setBulkAssignQuery}
          assignOptions={bulkMentionsQuery.data ?? []}
          assignLoading={bulkMentionsQuery.isFetching}
          assignPending={bulkAssignMutation.isPending}
          onAssignSelect={(candidate) => bulkAssignMutation.mutate(candidate.uniqueName ?? candidate.displayName)}
        />
      ) : null}
      <div
        className="grid min-h-0 flex-1 items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_8px_minmax(300px,var(--work-item-preview-width))]"
        style={{ "--work-item-preview-width": `${previewWidth}px` } as CSSProperties}
      >
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-white">
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[760px]">
              <div
                role="row"
                className="grid items-center gap-2 border-b border-border bg-gray-50 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                style={{ gridTemplateColumns: wiColTemplate }}
              >
                <div role="columnheader" className="flex items-center justify-center">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={sorted.length > 0 && sorted.every((item) => checkedIds.has(`${item.organizationId}:${item.projectId}:${item.id}`))}
                    ref={(el) => {
                      if (el) {
                        const some = sorted.some((item) => checkedIds.has(`${item.organizationId}:${item.projectId}:${item.id}`));
                        const all = sorted.length > 0 && sorted.every((item) => checkedIds.has(`${item.organizationId}:${item.projectId}:${item.id}`));
                        el.indeterminate = some && !all;
                      }
                    }}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setCheckedIds(new Set(sorted.map((item) => `${item.organizationId}:${item.projectId}:${item.id}`)));
                      } else {
                        setCheckedIds(new Set());
                      }
                      setLastCheckedIndex(null);
                    }}
                    className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300"
                  />
                </div>
                {WI_GRID_KEYS.map((col, i) => (
                  <WiSortHeaderButton
                    key={col}
                    column={col}
                    sort={sort}
                    onSort={applyWiSort}
                    resizeHandle={
                      i < WI_GRID_KEYS.length - 1 ? (
                        <ColumnResizeHandle
                          columnIndex={i}
                          widths={columnWidths}
                          setWidths={setColumnWidths}
                          min={WI_COLUMN_MIN_WIDTHS[i]}
                          max={WI_COLUMN_MAX_WIDTHS[i]}
                        />
                      ) : undefined
                    }
                  />
                ))}
              </div>

              {loading ? (
                <LoadingState />
              ) : !searched ? (
                <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
                  {emptyMessage ?? "Run a search to load work items."}
                </div>
              ) : sorted.length === 0 ? (
                <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
                  No work items matched.
                </div>
              ) : (
                <div
                  role="grid"
                  aria-label="Work items"
                  data-primary-grid="true"
                  tabIndex={-1}
                >
                  {sorted.map((item, i) => (
                    <WorkItemGridRow
                      key={`${item.organizationId}:${item.projectId}:${item.id}`}
                      ref={(el) => {
                        rowRefs.current[i] = el;
                      }}
                      item={item}
                      selected={i === selectedIndex}
                      checked={checkedIds.has(`${item.organizationId}:${item.projectId}:${item.id}`)}
                      columnTemplate={wiColTemplate}
                      onSelect={() => setSelectedIndex(i)}
                      onCheckedChange={(checked, shiftKey) => handleCheckboxChange(i, checked, shiftKey)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border px-2 py-1 text-xs text-muted-foreground">
            <span>
              {loading
                ? "Loading…"
                : searched
                  ? `${sorted.length} item${sorted.length === 1 ? "" : "s"}`
                  : "Ready"}
            </span>
            <ShortcutHint>Alt+G</ShortcutHint>
          </div>
        </div>

        <ResizeHandle
          ariaLabel="Resize work item preview"
          className="hidden xl:flex"
          direction={-1}
          max={860}
          min={300}
          onChange={setPreviewWidth}
          onReset={() => setPreviewWidth(DEFAULT_WORK_ITEM_PREVIEW_WIDTH)}
          value={previewWidth}
        />

        <WorkItemPreviewPanel
          focusCommentRequest={focusCommentRequest}
          openAssigneeRequest={openAssigneeRequest}
          openStateRequest={openStateRequest}
          preview={previewQuery.data ?? null}
          previewError={previewQuery.isError ? commandErrorMessage(previewQuery.error) : null}
          previewLoading={previewQuery.isFetching}
          selectedItem={selectedItem}
        />
      </div>
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
  assignOptions: MentionCandidate[];
  assignLoading: boolean;
  assignPending: boolean;
  onAssignSelect: (candidate: MentionCandidate) => void;
}) {
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
            <div className="absolute left-0 top-full z-30 mt-1 min-w-[130px] rounded-md border border-border bg-white py-1 shadow-lg">
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
                    onKeyDown={(e) => { if (e.key === "Escape") onStateOpenChange(false); }}
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
                autoFocus
                value={assignQuery}
                onChange={(e) => onAssignQueryChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") onAssignOpenChange(false); }}
                placeholder="Search assignee..."
                className="mb-1 h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="max-h-44 overflow-auto">
                {assignLoading ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">Searching…</div>
                ) : assignOptions.length > 0 ? (
                  assignOptions.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onAssignSelect(c)}
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
                    {assignQuery.trim() ? "No matches" : "Type to search"}
                  </div>
                )}
              </div>
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
