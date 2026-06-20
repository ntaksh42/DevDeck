import {
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import {
  listWorkItemTypeStates,
  setWorkItemsState,
  commandErrorMessage,
  type WorkItemSummary,
} from '@/lib/azdoCommands';
import { isEditableTarget } from '@/lib/utils';
import { openExternalUrl } from '@/lib/openExternal';
import { invalidateWorkItemMutationCaches, workItemQueryKeys } from './queryKeys';

const PRIORITY_REFERENCE_NAME = 'Microsoft.VSTS.Common.Priority';
// Columns taller than this switch to a windowed (virtual) render so a state with
// hundreds of cards does not mount every node at once.
const BOARD_VIRTUALIZE_THRESHOLD = 20;
const BOARD_CARD_HEIGHT = 76;
const BOARD_CARD_GAP = 8;
const BOARD_ROW_STRIDE = BOARD_CARD_HEIGHT + BOARD_CARD_GAP;
const BOARD_OVERSCAN = 6;
const UNKNOWN_STATE_COLUMN = '(no state)';

function workItemKey(item: Pick<WorkItemSummary, 'organizationId' | 'projectId' | 'id'>): string {
  return `${item.organizationId}:${item.projectId}:${item.id}`;
}

function cardPriority(item: WorkItemSummary): string | null {
  return (
    item.extraFields.find(
      (field) => field.referenceName.toLowerCase() === PRIORITY_REFERENCE_NAME.toLowerCase(),
    )?.value ?? null
  );
}

function columnStateKey(state: string | null): string {
  return state && state.trim() ? state : UNKNOWN_STATE_COLUMN;
}

export type BoardColumn = {
  state: string;
  items: WorkItemSummary[];
};

export function buildColumns(
  items: WorkItemSummary[],
  orderedStates: string[],
): BoardColumn[] {
  const grouped = new Map<string, WorkItemSummary[]>();
  for (const item of items) {
    const key = columnStateKey(item.state);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }
  const columns: BoardColumn[] = [];
  const seen = new Set<string>();
  // Defined states first, in their declared order.
  for (const state of orderedStates) {
    columns.push({ state, items: grouped.get(state) ?? [] });
    seen.add(state);
  }
  // Then any states present in the results that the type definition did not list
  // (e.g. mixed work item types, custom states), in encounter order.
  for (const item of items) {
    const key = columnStateKey(item.state);
    if (seen.has(key)) continue;
    seen.add(key);
    columns.push({ state: key, items: grouped.get(key) ?? [] });
  }
  return columns;
}

function BoardCard({
  item,
  selected,
  dragging,
  cardRef,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  item: WorkItemSummary;
  selected: boolean;
  dragging: boolean;
  cardRef: (element: HTMLDivElement | null) => void;
  onSelect: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const priority = cardPriority(item);
  return (
    <div
      ref={cardRef}
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      draggable
      onClick={onSelect}
      onFocus={onSelect}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', workItemKey(item));
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`flex flex-col gap-1 rounded-md border bg-card p-2 text-left outline-none transition-colors focus:ring-2 focus:ring-inset focus:ring-ring ${
        dragging ? 'opacity-40' : ''
      } ${selected ? 'border-primary bg-secondary' : 'border-border hover:bg-muted/60'}`}
      style={{ height: BOARD_CARD_HEIGHT, cursor: 'grab' }}
    >
      <span className="line-clamp-2 text-xs font-medium leading-tight text-foreground" title={item.title}>
        {item.title}
      </span>
      <div className="mt-auto flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (item.webUrl) openExternalUrl(item.webUrl);
          }}
          className="shrink-0 font-mono text-primary hover:underline"
          title={`#${item.id}`}
        >
          #{item.id}
        </button>
        <span className="min-w-0 flex-1 truncate text-right" title={item.assignedTo ?? 'Unassigned'}>
          {item.assignedTo ?? 'Unassigned'}
        </span>
        {priority ? (
          <span
            className="shrink-0 rounded border border-border px-1 font-mono"
            title={`Priority ${priority}`}
          >
            P{priority}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function BoardColumnView({
  column,
  columnIndex,
  selectedKey,
  draggingKey,
  dropActive,
  registerCard,
  onSelectCard,
  onDragStartCard,
  onDragEndCard,
  onDragOverColumn,
  onDragLeaveColumn,
  onDropColumn,
}: {
  column: BoardColumn;
  columnIndex: number;
  selectedKey: string | null;
  draggingKey: string | null;
  dropActive: boolean;
  registerCard: (key: string, element: HTMLDivElement | null) => void;
  onSelectCard: (columnIndex: number, cardIndex: number) => void;
  onDragStartCard: (key: string) => void;
  onDragEndCard: () => void;
  onDragOverColumn: (columnIndex: number, event: DragEvent<HTMLDivElement>) => void;
  onDragLeaveColumn: () => void;
  onDropColumn: (columnIndex: number, event: DragEvent<HTMLDivElement>) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ height: 0, scrollTop: 0 });

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    function update() {
      setViewport({ height: scroller!.clientHeight, scrollTop: scroller!.scrollTop });
    }
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, []);

  const virtualize = column.items.length > BOARD_VIRTUALIZE_THRESHOLD;
  const firstRow = virtualize
    ? Math.max(0, Math.floor(viewport.scrollTop / BOARD_ROW_STRIDE) - BOARD_OVERSCAN)
    : 0;
  const visibleCount = virtualize
    ? Math.ceil(Math.max(viewport.height, BOARD_ROW_STRIDE) / BOARD_ROW_STRIDE) + BOARD_OVERSCAN * 2
    : column.items.length;
  const lastRow = virtualize
    ? Math.min(column.items.length, firstRow + visibleCount)
    : column.items.length;
  const rows = column.items.slice(firstRow, lastRow);
  const topPad = virtualize ? firstRow * BOARD_ROW_STRIDE : 0;
  const bottomPad = virtualize ? Math.max(0, column.items.length - lastRow) * BOARD_ROW_STRIDE : 0;

  return (
    <div className="flex min-h-0 w-64 shrink-0 flex-col rounded-md border border-border bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="truncate text-xs font-semibold" title={column.state}>
          {column.state}
        </span>
        <span className="shrink-0 rounded bg-secondary px-1.5 text-[11px] text-muted-foreground">
          {column.items.length}
        </span>
      </div>
      <div
        ref={scrollRef}
        role="listbox"
        aria-label={`${column.state} (${column.items.length})`}
        onDragOver={(event) => onDragOverColumn(columnIndex, event)}
        onDragLeave={onDragLeaveColumn}
        onDrop={(event) => onDropColumn(columnIndex, event)}
        className={`min-h-0 flex-1 overflow-auto p-2 ${dropActive ? 'bg-primary/10 ring-2 ring-inset ring-primary' : ''}`}
      >
        {column.items.length === 0 ? (
          <p className="px-1 py-2 text-[11px] text-muted-foreground">No items</p>
        ) : (
          <div style={{ paddingTop: topPad, paddingBottom: bottomPad }}>
            <div className="flex flex-col" style={{ gap: BOARD_CARD_GAP }}>
              {rows.map((item, index) => {
                const cardIndex = firstRow + index;
                const key = workItemKey(item);
                return (
                  <BoardCard
                    key={key}
                    item={item}
                    selected={selectedKey === key}
                    dragging={draggingKey === key}
                    cardRef={(element) => registerCard(key, element)}
                    onSelect={() => onSelectCard(columnIndex, cardIndex)}
                    onDragStart={() => onDragStartCard(key)}
                    onDragEnd={onDragEndCard}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function WorkItemBoard({
  organizationId,
  projectId,
  results,
  autoFocus = false,
}: {
  organizationId: string;
  projectId: string;
  results: WorkItemSummary[];
  autoFocus?: boolean;
}) {
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  // Optimistic state overrides keyed by work item key.
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<{ column: number; card: number }>({ column: 0, card: 0 });
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const focusKeyRef = useRef<string | null>(null);

  const effectiveResults = useMemo(
    () =>
      results.map((item) => {
        const override = overrides.get(workItemKey(item));
        return override !== undefined ? { ...item, state: override } : item;
      }),
    [overrides, results],
  );

  // The board groups by state, so the relevant work item types are whatever the
  // result set contains. Fetch the declared state order for each type and merge.
  const workItemTypes = useMemo(() => {
    const types = new Set<string>();
    for (const item of results) {
      if (item.workItemType) types.add(item.workItemType);
    }
    return [...types];
  }, [results]);

  const stateQueries = useQueries({
    queries: workItemTypes.map((workItemType) => ({
      queryKey: workItemQueryKeys.typeStates(organizationId, projectId, workItemType),
      queryFn: () =>
        listWorkItemTypeStates({ organizationId, projectId, workItemType }),
      enabled: !!organizationId && !!projectId && !!workItemType,
      staleTime: Infinity,
    })),
  });

  const statesLoading = stateQueries.some((query) => query.isLoading);
  const orderedStates = useMemo(() => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const query of stateQueries) {
      for (const state of query.data ?? []) {
        if (seen.has(state)) continue;
        seen.add(state);
        ordered.push(state);
      }
    }
    return ordered;
    // stateQueries is a fresh array each render; depend on the merged data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateQueries.map((query) => (query.data ?? []).join(',')).join('|')]);

  const columns = useMemo(
    () => buildColumns(effectiveResults, orderedStates),
    [effectiveResults, orderedStates],
  );

  // Keep the selection in range as columns/cards change.
  useEffect(() => {
    setSelected((current) => {
      if (columns.length === 0) return { column: 0, card: 0 };
      const column = Math.min(current.column, columns.length - 1);
      const cardCount = columns[column]?.items.length ?? 0;
      const card = cardCount === 0 ? 0 : Math.min(current.card, cardCount - 1);
      return { column, card };
    });
  }, [columns]);

  useEffect(() => {
    if (autoFocus) containerRef.current?.focus();
  }, [autoFocus]);

  const selectedItem = columns[selected.column]?.items[selected.card] ?? null;
  const selectedKey = selectedItem ? workItemKey(selectedItem) : null;

  // After a keyboard move, focus the newly selected card so navigation keeps
  // working from the new state column.
  useEffect(() => {
    const key = focusKeyRef.current;
    if (!key) return;
    focusKeyRef.current = null;
    window.setTimeout(() => cardRefs.current.get(key)?.focus(), 0);
  }, [selectedKey]);

  function registerCard(key: string, element: HTMLDivElement | null) {
    if (element) cardRefs.current.set(key, element);
    else cardRefs.current.delete(key);
  }

  function selectCard(column: number, card: number, focusCard = false) {
    if (focusCard) {
      const item = columns[column]?.items[card];
      if (item) focusKeyRef.current = workItemKey(item);
    }
    setSelected({ column, card });
  }

  async function moveItemToState(item: WorkItemSummary, targetState: string) {
    const key = workItemKey(item);
    const previousState = item.state;
    if (columnStateKey(previousState) === columnStateKey(targetState)) return;
    // Optimistically move the card; keep selection on it so the user can chain moves.
    setOverrides((current) => {
      const next = new Map(current);
      next.set(key, targetState);
      return next;
    });
    focusKeyRef.current = key;
    try {
      const [result] = await setWorkItemsState({
        organizationId: item.organizationId,
        projectId: item.projectId,
        workItemIds: [item.id],
        state: targetState,
      });
      if (result?.error) throw new Error(result.error);
      invalidateWorkItemMutationCaches(queryClient);
    } catch (error) {
      // Roll back the optimistic move.
      setOverrides((current) => {
        const next = new Map(current);
        if (previousState === null) next.delete(key);
        else next.set(key, previousState);
        return next;
      });
      setToast(`Move failed: ${commandErrorMessage(error)}`);
      window.setTimeout(() => setToast(null), 3000);
    }
  }

  function handleDragOverColumn(columnIndex: number, event: DragEvent<HTMLDivElement>) {
    if (!draggingKey) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropColumn(columnIndex);
  }

  function handleDropColumn(columnIndex: number, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDropColumn(null);
    const key = event.dataTransfer.getData('text/plain') || draggingKey;
    setDraggingKey(null);
    if (!key) return;
    const item = effectiveResults.find((entry) => workItemKey(entry) === key);
    const target = columns[columnIndex];
    if (!item || !target) return;
    void moveItemToState(item, target.state);
  }

  function moveSelectedCardToColumn(delta: number) {
    if (!selectedItem) return;
    const targetIndex = selected.column + delta;
    const target = columns[targetIndex];
    if (!target) return;
    void moveItemToState(selectedItem, target.state);
    setSelected((current) => ({ column: targetIndex, card: current.card }));
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (isEditableTarget(event.target) || columns.length === 0) return;
    if (event.metaKey || event.altKey) return;
    const column = columns[selected.column];
    if (!column) return;

    // Shift+Arrow moves the selected card to the adjacent state column.
    if (event.shiftKey) {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        moveSelectedCardToColumn(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveSelectedCardToColumn(-1);
      }
      return;
    }
    if (event.ctrlKey) return;

    if (event.key === 'ArrowDown' || event.key === 'j' || event.key === 'J') {
      event.preventDefault();
      selectCard(selected.column, Math.min(selected.card + 1, Math.max(0, column.items.length - 1)), true);
    } else if (event.key === 'ArrowUp' || event.key === 'k' || event.key === 'K') {
      event.preventDefault();
      selectCard(selected.column, Math.max(selected.card - 1, 0), true);
    } else if (event.key === 'ArrowRight' || event.key === 'l' || event.key === 'L') {
      event.preventDefault();
      const next = Math.min(selected.column + 1, columns.length - 1);
      const cardCount = columns[next]?.items.length ?? 0;
      selectCard(next, Math.min(selected.card, Math.max(0, cardCount - 1)), true);
    } else if (event.key === 'ArrowLeft' || event.key === 'h' || event.key === 'H') {
      event.preventDefault();
      const prev = Math.max(selected.column - 1, 0);
      const cardCount = columns[prev]?.items.length ?? 0;
      selectCard(prev, Math.min(selected.card, Math.max(0, cardCount - 1)), true);
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectCard(selected.column, 0, true);
    } else if (event.key === 'End') {
      event.preventDefault();
      selectCard(selected.column, Math.max(0, column.items.length - 1), true);
    } else if (event.key === 'o' || event.key === 'O') {
      event.preventDefault();
      if (selectedItem?.webUrl) openExternalUrl(selectedItem.webUrl);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (event.ctrlKey && selectedItem?.webUrl) openExternalUrl(selectedItem.webUrl);
    }
  }

  if (workItemTypes.length > 0 && statesLoading && orderedStates.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Loading board…
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No work items to display on the board.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="group"
      aria-label="Work item board. Use arrow keys to move between cards, Shift+Arrow to change a card's state."
      onKeyDown={handleKeyDown}
      className="flex min-h-0 flex-1 gap-3 overflow-x-auto outline-none"
    >
      {toast ? (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-3 py-1 text-xs text-background shadow-lg">
          {toast}
        </div>
      ) : null}
      {columns.map((column, columnIndex) => (
        <BoardColumnView
          key={column.state}
          column={column}
          columnIndex={columnIndex}
          selectedKey={columnIndex === selected.column ? selectedKey : null}
          draggingKey={draggingKey}
          dropActive={dropColumn === columnIndex}
          registerCard={registerCard}
          onSelectCard={(c, card) => selectCard(c, card)}
          onDragStartCard={(key) => setDraggingKey(key)}
          onDragEndCard={() => {
            setDraggingKey(null);
            setDropColumn(null);
          }}
          onDragOverColumn={handleDragOverColumn}
          onDragLeaveColumn={() => setDropColumn(null)}
          onDropColumn={handleDropColumn}
        />
      ))}
    </div>
  );
}
