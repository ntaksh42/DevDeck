import { useEffect, useRef } from "react";

/**
 * Popover for toggling which grid columns are visible. Required columns are
 * shown disabled+checked so they can never be hidden. Closes on outside click
 * or Escape, matching the column-filter dropdowns.
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

  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const top = Math.min(anchorRect.bottom + 2, window.innerHeight - 300);
  const left = Math.min(anchorRect.left, window.innerWidth - 224);

  return (
    <div
      ref={ref}
      className="fixed z-50 w-56 rounded-md border border-border bg-white p-1 shadow-lg"
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
          onClick={onReset}
          className="w-full rounded px-2 py-0.5 text-left text-xs hover:bg-secondary"
        >
          Show all
        </button>
      </div>
    </div>
  );
}
