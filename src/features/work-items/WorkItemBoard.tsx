import {
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import {
  getWorkItemPreview,
  listWorkItemTypeStates,
  setWorkItemsState,
  commandErrorMessage,
  type WorkItemPreview,
  type WorkItemSummary,
} from '@/lib/azdoCommands';
import { focusPrimaryPreview, isEditableTarget } from '@/lib/utils';
import { openExternalUrl } from '@/lib/openExternal';
import { WorkItemPreviewPanel } from './WorkItemPreviewPanel';
import {
  loadCustomPreviewFields,
  storeCustomPreviewFields,
  type CustomPreviewField,
} from './previewFieldsStorage';
import { invalidateWorkItemMutationCaches, workItemQueryKeys } from './queryKeys';
import {
  type BoardColumn,
  buildColumns,
  workItemKey,
  columnStateKey,
  BoardColumnView,
} from './BoardColumn';

export type { BoardColumn };
export { buildColumns };

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

  // Side preview so the board reaches feature parity with the list view
  // (edit fields / comment), reusing the same WorkItemPreviewPanel (#450).
  const [customPreviewFields, setCustomPreviewFields] = useState<CustomPreviewField[]>(
    () => loadCustomPreviewFields(),
  );
  const customPreviewFieldRefs = useMemo(
    () => customPreviewFields.map((field) => field.referenceName),
    [customPreviewFields],
  );
  const customPreviewFieldSignature = customPreviewFieldRefs.join(",");
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

  function handlePreviewUpdated(preview: WorkItemPreview) {
    queryClient.setQueryData(
      workItemQueryKeys.preview(
        preview.organizationId,
        preview.projectId,
        preview.id,
        customPreviewFieldSignature,
      ),
      preview,
    );
    invalidateWorkItemMutationCaches(queryClient);
  }

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
      // Move focus into the side preview so its fields/comment are editable from
      // the keyboard, matching the list view (#450).
      event.preventDefault();
      focusPrimaryPreview();
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
    <div className="flex min-h-0 flex-1 gap-3">
      <div
        ref={containerRef}
        tabIndex={-1}
        role="group"
        aria-label="Work item board. Use arrow keys to move between cards, Shift+Arrow to change a card's state, Enter to open the preview."
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
      <div className="hidden w-[380px] shrink-0 lg:flex lg:flex-col">
        <WorkItemPreviewPanel
          customPreviewFields={customPreviewFields}
          onCustomPreviewFieldsChange={(fields) => {
            storeCustomPreviewFields(fields);
            setCustomPreviewFields(fields);
          }}
          preview={previewQuery.data ?? null}
          previewError={previewQuery.isError ? commandErrorMessage(previewQuery.error) : null}
          previewLoading={previewQuery.isFetching}
          selectedItem={selectedItem}
          onPreviewUpdated={handlePreviewUpdated}
        />
      </div>
    </div>
  );
}
