import { useEffect, useRef, useState } from 'react';

export function WiColumnFilterDropdown({
  anchorRect,
  allValues,
  activeValues,
  onToggle,
  onClearAll,
  onUncheckAll,
  onClose,
}: {
  anchorRect: DOMRect;
  allValues: string[];
  activeValues: Set<string> | undefined;
  onToggle: (value: string) => void;
  onClearAll: () => void;
  onUncheckAll: () => void;
  onClose: () => void;
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!dropdownRef.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const isAllChecked = activeValues === undefined;
  const anyChecked = isAllChecked || (activeValues?.size ?? 0) > 0;
  const filteredValues = search.trim()
    ? allValues.filter(v => v.toLowerCase().includes(search.trim().toLowerCase()))
    : allValues;

  const top = Math.min(anchorRect.bottom + 2, window.innerHeight - 280);
  const left = Math.min(anchorRect.left, window.innerWidth - 208);

  return (
    <div
      ref={dropdownRef}
      className="fixed z-50 w-52 rounded-md border border-border bg-popover shadow-lg"
      style={{ top, left }}
    >
      <div className="border-b border-border p-1.5">
        <input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search…"
          className="w-full rounded border border-input bg-background px-2 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="flex items-center gap-1 border-b border-border p-1">
        <button
          type="button"
          onClick={onClearAll}
          className={`flex-1 rounded px-2 py-0.5 text-left text-xs hover:bg-secondary ${
            isAllChecked ? "font-medium text-foreground" : "text-muted-foreground"
          }`}
        >
          (All)
        </button>
        <button
          type="button"
          onClick={onUncheckAll}
          disabled={!anyChecked}
          className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-secondary disabled:cursor-default disabled:opacity-40"
        >
          Uncheck all
        </button>
      </div>
      <div className="max-h-44 overflow-auto p-1">
        {filteredValues.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">No values</p>
        ) : (
          filteredValues.map(value => {
            const checked = isAllChecked || (activeValues?.has(value) ?? false);
            return (
              <label
                key={value}
                className="flex cursor-pointer select-none items-center gap-1.5 rounded px-2 py-0.5 text-xs hover:bg-secondary"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(value)}
                  className="h-3 w-3"
                />
                <span className="truncate">{value || "(empty)"}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
