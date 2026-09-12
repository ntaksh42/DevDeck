import {
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { GripHorizontal, GripVertical } from "lucide-react";
import { clamp } from "@/lib/utils";

function beginAxisResize(
  event: ReactPointerEvent,
  options: {
    value: number;
    min: number;
    max: number;
    direction: 1 | -1;
    /** Which pointer coordinate drives the drag: `clientX` for a left/right
        split's handle, `clientY` for an above/below one. */
    axis: "x" | "y";
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
  const pointerPos = (pointerEvent: { clientX: number; clientY: number }) =>
    options.axis === "y" ? pointerEvent.clientY : pointerEvent.clientX;

  // The gesture is tracked as an offset from an anchor -- a known-good
  // (pointerPos, value) pair -- rather than by summing per-move deltas, so the
  // panel follows the pointer exactly however fast it moves.
  //
  // The anchor is reset whenever the consumer does not apply what we asked for.
  // `onChange` returns the size actually applied (dockview clamps a group to
  // what the surrounding layout allows -- a sibling panel's own minWidth stops
  // the drag long before this handle's `max`). Re-anchoring onto that wall is
  // what lets a drag back off it respond on the very next move: without it the
  // request keeps climbing past anything that was granted, and dragging back
  // has to unwind the whole phantom overshoot before the panel moves at all --
  // the dead zone that reads as resizing being broken.
  //
  // The applied size has to come back from `onChange` itself. Sampling it from
  // a prop or state instead cannot work: that value is updated asynchronously,
  // so a clamp and a not-yet-delivered echo look exactly alike at any single
  // moment, and guessing between them either reintroduces the dead zone or
  // makes a fast drag crawl.
  let anchorPos = pointerPos(event);
  let anchorValue = options.value;
  let requested = options.value;

  function onPointerMove(moveEvent: PointerEvent) {
    if (moveEvent.pointerId !== pointerId) return;

    const delta = (pointerPos(moveEvent) - anchorPos) * options.direction;
    const next = clamp(anchorValue + delta, options.min, options.max);
    if (next === requested) return;

    requested = next;
    const applied = options.onChange(next);

    if (typeof applied === "number" && applied !== next) {
      anchorPos = pointerPos(moveEvent);
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
  axis = "x",
  className,
  style,
  direction,
  max,
  min,
  onChange,
  onReset,
  value,
}: {
  ariaLabel: string;
  /** Which edge this handle sits on and which way it drags: `"x"` (default)
      for a left/right split's vertical-line handle, `"y"` for an above/below
      split's horizontal-line one. */
  axis?: "x" | "y";
  className?: string;
  style?: CSSProperties;
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
  const vertical = axis === "y";

  function nudge(delta: number) {
    onChange(clamp(value + delta * direction, min, max));
  }

  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      title="Drag to resize · double-click or Escape to reset to the default width"
      aria-orientation={vertical ? "horizontal" : "vertical"}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={(event) =>
        beginAxisResize(event, { value, min, max, direction, axis, onChange })
      }
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const decreaseKey = vertical ? "ArrowUp" : "ArrowLeft";
        const increaseKey = vertical ? "ArrowDown" : "ArrowRight";
        if (event.key === decreaseKey) {
          event.preventDefault();
          nudge(-16);
        } else if (event.key === increaseKey) {
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
      // No position utility here: every caller supplies one (`absolute ...`)
      // via `className`, and Tailwind's generated CSS defines `.relative`
      // after `.absolute`, so a base `relative` class would win the position
      // property regardless of class order in the string -- silently turning
      // the portaled full-height overlay (GroupResizeOverlay) into a normal
      // in-flow flex item that steals height from its sibling content.
      className={`z-20 flex items-center justify-center text-muted-foreground outline-none hover:bg-secondary focus:bg-secondary focus:ring-2 focus:ring-ring ${
        vertical ? "h-2 cursor-row-resize" : "w-2 cursor-col-resize"
      } ${className ?? ""}`}
      style={style}
    >
      {/*
        The visible 8px strip is easy to miss with the pointer -- a drag that
        lands just outside it falls through to dockview's own group sash
        underneath, which resizes without this handle's clamp/re-anchor logic
        and reproduces the same dead zone bug this component exists to fix.
        This invisible pad widens the hit area without widening what's drawn,
        so the grip still reads as a thin line.
      */}
      <div
        className={
          vertical
            ? "absolute inset-x-0 -top-1.5 -bottom-1.5 z-0 cursor-row-resize"
            : "absolute inset-y-0 -left-1.5 -right-1.5 z-0 cursor-col-resize"
        }
        aria-hidden="true"
      />
      {vertical ? (
        <GripHorizontal className="relative z-10 h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <GripVertical className="relative z-10 h-4 w-4 shrink-0" aria-hidden="true" />
      )}
    </div>
  );
}
