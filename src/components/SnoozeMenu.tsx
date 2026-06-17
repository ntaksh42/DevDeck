import { useEffect, useRef, useState } from "react";
import {
  SNOOZE_PRESETS,
  localInputToIso,
  presetToIso,
} from "@/lib/snoozePresets";

// Anchored popover for choosing a snooze deadline: fixed presets plus a custom
// local datetime. Calls onSnooze with a UTC ISO8601 instant and closes.
export function SnoozeMenu({
  anchorRect,
  onSnooze,
  onClose,
}: {
  anchorRect: DOMRect;
  onSnooze: (snoozeUntil: string) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [customValue, setCustomValue] = useState("");

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const top = Math.min(anchorRect.bottom + 2, window.innerHeight - 280);
  const left = Math.min(anchorRect.left, window.innerWidth - 240);
  const customIso = localInputToIso(customValue);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Snooze until"
      className="fixed z-50 w-60 rounded-md border border-border bg-popover shadow-lg"
      style={{ top, left }}
    >
      <div className="border-b border-border px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Snooze until
      </div>
      <div className="p-1">
        {SNOOZE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="menuitem"
            onClick={() => onSnooze(presetToIso(preset))}
            className="w-full rounded px-2 py-1 text-left text-sm hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="border-t border-border p-2">
        <label className="mb-1 block text-xs text-muted-foreground">
          Custom date &amp; time
        </label>
        <input
          type="datetime-local"
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          type="button"
          disabled={!customIso}
          onClick={() => {
            if (customIso) onSnooze(customIso);
          }}
          className="mt-1.5 w-full rounded border border-border bg-card px-2 py-1 text-xs hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          Snooze until selected
        </button>
      </div>
    </div>
  );
}
