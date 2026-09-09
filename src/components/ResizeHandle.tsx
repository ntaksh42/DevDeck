import {
  type Dispatch,
  type SetStateAction,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { GripVertical } from "lucide-react";
import { clamp } from "@/lib/utils";

function beginHorizontalResize(
  event: ReactPointerEvent,
  options: {
    value: number;
    min: number;
    max: number;
    direction: 1 | -1;
    /**
     * Applies the new value. May return the value actually applied when that
     * can differ from what was requested; returning nothing means "applied as
     * requested".
     */
    onChange: (value: number) => number | void;
  },
) {
  event.preventDefault();
  event.stopPropagation();
  const target = event.currentTarget;
  const pointerId = event.pointerId;

  // The gesture is tracked as an offset from an anchor -- a known-good
  // (pointerX, value) pair -- rather than by summing per-move deltas, so the
  // panel follows the pointer exactly however fast it moves.
  //
  // The anchor is reset whenever the consumer does not apply what we asked for.
  // `onChange` returns the width actually applied (dockview clamps a group to
  // what the surrounding layout allows -- a sibling panel's own minWidth stops
  // the drag long before this handle's `max`). Re-anchoring onto that wall is
  // what lets a drag back off it respond on the very next move: without it the
  // request keeps climbing past anything that was granted, and dragging back
  // has to unwind the whole phantom overshoot before the panel moves at all --
  // the dead zone that reads as resizing being broken.
  //
  // The applied width has to come back from `onChange` itself. Sampling it from
  // a prop or state instead cannot work: that value is updated asynchronously,
  // so a clamp and a not-yet-delivered echo look exactly alike at any single
  // moment, and guessing between them either reintroduces the dead zone or
  // makes a fast drag crawl.
  let anchorX = event.clientX;
  let anchorValue = options.value;
  let requested = options.value;

  function onPointerMove(moveEvent: PointerEvent) {
    if (moveEvent.pointerId !== pointerId) return;

    const delta = (moveEvent.clientX - anchorX) * options.direction;
    const next = clamp(anchorValue + delta, options.min, options.max);
    if (next === requested) return;

    requested = next;
    const applied = options.onChange(next);

    if (typeof applied === "number" && applied !== next) {
      anchorX = moveEvent.clientX;
      anchorValue = applied;
      requested = applied;
    }
  }

  function cleanup() {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerEnd);
    window.removeEventListener("pointercancel", onPointerEnd);
    window.removeEventListener("blur", cleanup);
    target.removeEventListener("lostpointercapture", cleanup);
    if (target.hasPointerCapture?.(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
  }

  function onPointerEnd(endEvent: PointerEvent) {
    if (endEvent.pointerId !== pointerId) return;
    cleanup();
  }

  target.setPointerCapture?.(pointerId);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerEnd);
  window.addEventListener("pointercancel", onPointerEnd);
  window.addEventListener("blur", cleanup);
  target.addEventListener("lostpointercapture", cleanup);
}

export function ColumnResizeHandle({
  columnIndex,
  widths,
  setWidths,
  min,
  max,
  defaultWidth,
}: {
  columnIndex: number;
  widths: number[];
  setWidths: Dispatch<SetStateAction<number[]>>;
  min: number;
  max: number;
  /** Width restored on double-click. Reset is disabled when omitted. */
  defaultWidth?: number;
}) {
  return (
    <div
      title="Drag to resize · double-click to reset this column to its default width"
      className="absolute right-0 top-0 bottom-0 z-10 w-1.5 cursor-col-resize hover:bg-primary/20 active:bg-primary/40"
      onDoubleClick={() => {
        if (defaultWidth === undefined) return;
        setWidths((prev) => {
          const next = [...prev];
          next[columnIndex] = clamp(defaultWidth, min, max);
          return next;
        });
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = widths[columnIndex];
        function onMove(ev: PointerEvent) {
          setWidths((prev) => {
            const next = [...prev];
            next[columnIndex] = clamp(startWidth + (ev.clientX - startX), min, max);
            return next;
          });
        }
        function onUp() {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        }
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      }}
    />
  );
}

export function ResizeHandle({
  ariaLabel,
  className,
  direction,
  max,
  min,
  onChange,
  onReset,
  value,
}: {
  ariaLabel: string;
  className?: string;
  direction: 1 | -1;
  max: number;
  min: number;
  /**
   * Applies the new value. Return the value actually applied when it can differ
   * from what was requested (e.g. a surrounding layout clamps it), so a drag
   * can re-anchor onto that limit; returning nothing means "applied as
   * requested".
   */
  onChange: (value: number) => number | void;
  onReset: () => void;
  value: number;
}) {
  function nudge(delta: number) {
    onChange(clamp(value + delta * direction, min, max));
  }

  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      title="Drag to resize · double-click or Escape to reset to the default width"
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={(event) =>
        beginHorizontalResize(event, { value, min, max, direction, onChange })
      }
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          nudge(-16);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          nudge(16);
        } else if (event.key === "Home") {
          event.preventDefault();
          onChange(direction === 1 ? min : max);
        } else if (event.key === "End") {
          event.preventDefault();
          onChange(direction === 1 ? max : min);
        } else if (event.key === "Escape") {
          event.preventDefault();
          onReset();
        }
      }}
      className={`z-20 w-2 cursor-col-resize items-center justify-center text-muted-foreground outline-none hover:bg-secondary focus:bg-secondary focus:ring-2 focus:ring-ring ${className ?? ""}`}
    >
      <GripVertical className="h-4 w-4" aria-hidden="true" />
    </div>
  );
}
