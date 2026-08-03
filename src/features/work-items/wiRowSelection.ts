import type { WorkItemSummary } from '@/lib/azdoCommands';

// Row selection for the work items grid. Unlike the other grids (which use
// `useRangeSelection`), selection here *is* the checkbox state the bulk actions
// read, so checkbox clicks, Shift ranges, and Ctrl toggles all write the same
// `checkedIds` set.
export interface WiSelectionDeps {
  displayed: WorkItemSummary[];
  selectedIndex: number;
  lastCheckedIndex: number | null;
  setCheckedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setLastCheckedIndex: React.Dispatch<React.SetStateAction<number | null>>;
}

export function workItemKey(item: WorkItemSummary): string {
  return `${item.organizationId}:${item.projectId}:${item.id}`;
}

export function createWiRowSelection({
  displayed,
  selectedIndex,
  lastCheckedIndex,
  setCheckedIds,
  setLastCheckedIndex,
}: WiSelectionDeps) {
  // Checkbox click. Shift extends from the last checkbox the user touched.
  function handleCheckboxChange(index: number, checked: boolean, shiftKey: boolean) {
    const item = displayed[index];
    if (!item) return;
    const key = workItemKey(item);
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastCheckedIndex !== null) {
        const from = Math.min(lastCheckedIndex, index);
        const to = Math.max(lastCheckedIndex, index);
        for (let i = from; i <= to; i++) {
          const it = displayed[i];
          if (!it) continue;
          const k = workItemKey(it);
          if (checked) next.add(k); else next.delete(k);
        }
      } else {
        if (checked) next.add(key); else next.delete(key);
      }
      return next;
    });
    setLastCheckedIndex(index);
  }

  // Shift+click / Shift+Arrow range select. Callers pass `anchorIndex`
  // explicitly when the focused row has already moved to the clicked row, so
  // the first Shift+click still selects a range rather than a single row.
  function selectRangeTo(index: number, anchorIndex?: number) {
    const anchor = anchorIndex ?? lastCheckedIndex ?? selectedIndex;
    const from = Math.min(anchor, index);
    const to = Math.max(anchor, index);
    setCheckedIds(() => {
      const next = new Set<string>();
      for (let i = from; i <= to; i++) {
        const item = displayed[i];
        if (item) next.add(workItemKey(item));
      }
      return next;
    });
    setLastCheckedIndex(anchor);
  }

  // Ctrl+click adds or removes a single row, seeding from the focused row so
  // the first Ctrl+click grows the selection instead of replacing it.
  function toggleSelectionAt(index: number, focusedIndex: number) {
    const item = displayed[index];
    if (!item) return;
    const key = workItemKey(item);
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.size === 0) {
        const focused = displayed[focusedIndex];
        if (focused) next.add(workItemKey(focused));
      }
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setLastCheckedIndex(index);
  }

  function clearCheckedIds() {
    setCheckedIds(new Set());
    setLastCheckedIndex(null);
  }

  return { handleCheckboxChange, selectRangeTo, toggleSelectionAt, clearCheckedIds };
}
