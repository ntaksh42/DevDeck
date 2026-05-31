import {
  type Dispatch,
  type SetStateAction,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { GripVertical } from "lucide-react";
import { clamp } from "@/lib/utils";

export function beginHorizontalResize(
  event: ReactPointerEvent,
  options: {
    value: number;
    min: number;
    max: number;
    direction: 1 | -1;
    onChange: (value: number) => void;
  },
) {
  event.preventDefault();
  const startX = event.clientX;
  const startValue = options.value;

  function onPointerMove(moveEvent: PointerEvent) {
    const delta = (moveEvent.clientX - startX) * options.direction;
    options.onChange(clamp(startValue + delta, options.min, options.max));
  }

  function onPointerUp() {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}

export function ColumnResizeHandle({
  columnIndex,
  widths,
  setWidths,
  min,
  max,
}: {
  columnIndex: number;
  widths: number[];
  setWidths: Dispatch<SetStateAction<number[]>>;
  min: number;
  max: number;
}) {
  return (
    <div
      className="absolute right-0 top-0 bottom-0 z-10 w-1.5 cursor-col-resize hover:bg-primary/20 active:bg-primary/40"
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
  onChange: (value: number) => void;
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
