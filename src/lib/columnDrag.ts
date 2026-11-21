import { useState, type DragEvent } from "react";

/** Moves `from` into the slot currently held by `to`; other columns shift over. */
export function moveColumnTo<Key extends string>(
  current: readonly Key[],
  from: Key,
  to: Key,
): Key[] {
  const fromIndex = current.indexOf(from);
  const toIndex = current.indexOf(to);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return [...current];
  const next = [...current];
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, from);
  return next;
}

/** Props for one column header: `handle` goes on the sort button, `cell` on the columnheader. */
export type ColumnDragProps = {
  handle: {
    draggable: true;
    onDragStart: (event: DragEvent) => void;
    onDragEnd: () => void;
  };
  cell: {
    "data-drop-target": boolean;
    onDragOver: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
  };
};

/**
 * Drag-and-drop column reordering for grid headers. Only the sort button is
 * draggable (not the whole cell) so the column resize handle keeps its own
 * pointer drag. The keyboard path is the Columns menu (Alt+Up/Down).
 */
export function useColumnDrag<Key extends string>(
  onReorder: (from: Key, to: Key) => void,
): (key: Key) => ColumnDragProps {
  const [dragging, setDragging] = useState<Key | null>(null);
  const [over, setOver] = useState<Key | null>(null);

  function reset() {
    setDragging(null);
    setOver(null);
  }

  return (key) => ({
    handle: {
      draggable: true,
      onDragStart: (event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", key);
        setDragging(key);
      },
      onDragEnd: reset,
    },
    cell: {
      "data-drop-target": dragging !== null && dragging !== key && over === key,
      onDragOver: (event) => {
        if (dragging === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(key);
      },
      onDrop: (event) => {
        if (dragging === null) return;
        event.preventDefault();
        if (dragging !== key) onReorder(dragging, key);
        reset();
      },
    },
  });
}
