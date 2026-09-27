import { useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

// Draggable divider between the result and the notes. Also keyboard-operable:
// focus it (Tab) and use the arrow keys. The notes size is remembered.

const STEP = 24;

function load(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

/** Size in px of the notes side, remembered per orientation. */
export function useNotesSize(wide: boolean) {
  const key = wide ? "agentNotes.width" : "agentNotes.height";
  const [sizes, setSizes] = useState(() => ({
    wide: load("agentNotes.width", 300),
    tall: load("agentNotes.height", 320),
  }));
  const size = wide ? sizes.wide : sizes.tall;
  const setSize = (value: number) => {
    const next = Math.round(Math.max(180, value));
    setSizes((prev) => (wide ? { ...prev, wide: next } : { ...prev, tall: next }));
    try {
      localStorage.setItem(key, String(next));
    } catch {
      // Only a remembered preference.
    }
  };
  return [size, setSize] as const;
}

export function PaneSplitter({ wide, size, max, onResize }: {
  wide: boolean;
  size: number;
  /** Largest notes size that still leaves room for the result. */
  max: number;
  onResize: (size: number) => void;
}) {
  const clamp = (value: number) => Math.min(max, Math.max(180, value));

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const start = wide ? event.clientX : event.clientY;
    const startSize = size;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      // The notes sit right of / below the divider, so dragging toward them shrinks them.
      const delta = (wide ? e.clientX : e.clientY) - start;
      onResize(clamp(startSize - delta));
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const grow = wide ? "ArrowLeft" : "ArrowUp";
    const shrink = wide ? "ArrowRight" : "ArrowDown";
    if (event.key !== grow && event.key !== shrink) return;
    event.preventDefault();
    event.stopPropagation();
    onResize(clamp(size + (event.key === grow ? STEP : -STEP)));
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={wide ? "vertical" : "horizontal"}
      aria-label="Resize agent notes"
      aria-valuenow={size}
      aria-valuemin={180}
      aria-valuemax={max}
      title="Drag or use arrow keys to resize the notes"
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      className={`shrink-0 rounded bg-border/60 outline-none hover:bg-primary/40 focus:bg-primary/60 ${
        wide ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"
      }`}
    />
  );
}
