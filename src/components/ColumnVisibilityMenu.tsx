import { useEffect, useRef } from "react";

/**
 * Popover for toggling which grid columns are visible. Required columns are
 * shown disabled+checked so they can never be hidden. Closes on outside click
 * or Escape, matching the column-filter dropdowns.
 *
 * Keyboard: opens focused on the first toggle; Up/Down move between the
 * checkboxes and the "Show all" action; Space toggles; Escape closes. On close
 * focus returns to the originating grid (`data-primary-grid="true"`) so keyboard
 * navigation resumes there instead of being stranded (issue #442). Navigation
 * keys are contained so the grid behind the popover does not also react.
 */
export function ColumnVisibilityMenu<K extends string>({
  anchorRect,
  columns,
  visibleColumns,
  requiredColumns,
  onToggle,
  onReset,
  onClose,
}: {
  anchorRect: DOMRect;
  columns: { key: K; label: string }[];
  visibleColumns: K[];
  requiredColumns: K[];
  onToggle: (key: K) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Focus the first enabled control on open; restore focus to the owning grid on
  // close (looked up fresh because a re-render can replace its node; deferred a
  // frame so it wins over the grid's own focus restore).
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>(
      '[data-colvis-item="true"]:not([disabled])',
    );
    first?.focus();
    return () => {
      window.setTimeout(() => {
        document.querySelector<HTMLElement>('[data-primary-grid="true"]')?.focus();
      }, 0);
    };
  }, []);

  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose]);

  // Up/Down move between the enabled checkboxes and the "Show all" button,
  // wrapping at the ends.
  function moveFocus(delta: number) {
    const items = Array.from(
      ref.current?.querySelectorAll<HTMLElement>('[data-colvis-item="true"]') ?? [],
    ).filter((el) => !el.hasAttribute("disabled"));
    if (items.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const current = active ? items.indexOf(active) : -1;
    const next = (current + delta + items.length) % items.length;
    items[next]?.focus();
  }

  // Capture-phase guard so no keystroke reaches the grid behind the popover,
  // even in the frame before the first control takes focus.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (ref.current?.contains(event.target as Node)) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        moveFocus(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        moveFocus(-1);
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  function handleMenuKeyDown(event: React.KeyboardEvent) {
    // Keep navigation inside the menu; let Space/Enter act on the focused
    // control (checkbox toggle / button) without the grid also reacting.
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      moveFocus(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      moveFocus(-1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.stopPropagation();
    }
  }

  const top = Math.min(anchorRect.bottom + 2, window.innerHeight - 300);
  const left = Math.min(anchorRect.left, window.innerWidth - 224);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Visible columns"
      onKeyDown={handleMenuKeyDown}
      className="fixed z-50 w-56 rounded-md border border-border bg-popover p-1 shadow-lg"
      style={{ top, left }}
    >
      <div className="border-b border-border px-2 py-1.5 text-xs font-semibold text-foreground">
        Visible columns
      </div>
      <div className="py-1">
        {columns.map(({ key, label }) => {
          const required = requiredColumns.includes(key);
          return (
            <label
              key={key}
              className="flex cursor-pointer select-none items-center justify-between gap-2 rounded px-2 py-1 text-xs hover:bg-secondary"
            >
              <span>{label}</span>
              <input
                type="checkbox"
                data-colvis-item="true"
                checked={visibleColumns.includes(key)}
                disabled={required}
                onChange={() => onToggle(key)}
                className="h-3 w-3"
              />
            </label>
          );
        })}
      </div>
      <div className="border-t border-border p-1">
        <button
          type="button"
          data-colvis-item="true"
          onClick={onReset}
          className="w-full rounded px-2 py-0.5 text-left text-xs hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring"
        >
          Show all
        </button>
      </div>
    </div>
  );
}
