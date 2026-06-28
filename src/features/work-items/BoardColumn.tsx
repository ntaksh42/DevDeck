import {
  type DragEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { type WorkItemSummary } from '@/lib/azdoCommands';
import { openExternalUrl } from '@/lib/openExternal';

const PRIORITY_REFERENCE_NAME = 'Microsoft.VSTS.Common.Priority';
// Columns taller than this switch to a windowed (virtual) render so a state with
// hundreds of cards does not mount every node at once.
const BOARD_VIRTUALIZE_THRESHOLD = 20;
export const BOARD_CARD_HEIGHT = 76;
const BOARD_CARD_GAP = 8;
const BOARD_ROW_STRIDE = BOARD_CARD_HEIGHT + BOARD_CARD_GAP;
const BOARD_OVERSCAN = 6;
const UNKNOWN_STATE_COLUMN = '(no state)';

export function workItemKey(item: Pick<WorkItemSummary, 'organizationId' | 'projectId' | 'id'>): string {
  return `${item.organizationId}:${item.projectId}:${item.id}`;
}

function cardPriority(item: WorkItemSummary): string | null {
  return (
    item.extraFields.find(
      (field) => field.referenceName.toLowerCase() === PRIORITY_REFERENCE_NAME.toLowerCase(),
    )?.value ?? null
  );
}

export function columnStateKey(state: string | null): string {
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

export function BoardColumnView({
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
