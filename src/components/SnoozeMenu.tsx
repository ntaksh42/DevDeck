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

  // Focus the first preset on open so the whole flow (Z → arrows → Enter) is
  // keyboard-driven without touching the mouse.
  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLElement>(
      '[data-snooze-item="true"]',
    );
    first?.focus();
  }, []);

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

  // Up/Down move focus between the focusable controls (presets, the custom
  // input, the confirm button), wrapping at the ends.
  function moveFocus(delta: number) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[data-snooze-item="true"]') ??
        [],
    ).filter((el) => !el.hasAttribute("disabled"));
    if (items.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const current = active ? items.indexOf(active) : -1;
    const next = (current + delta + items.length) % items.length;
    items[next]?.focus();
  }

  function handleMenuKeyDown(e: React.KeyboardEvent) {
    // Keep navigation and activation inside the menu; otherwise the owning grid
    // also handles arrows (moving the row selection) and Enter.
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      moveFocus(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      moveFocus(-1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.stopPropagation();
    }
  }

  const top = Math.min(anchorRect.bottom + 2, window.innerHeight - 280);
  const left = Math.min(anchorRect.left, window.innerWidth - 240);
  const customIso = localInputToIso(customValue);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Snooze until"
      onKeyDown={handleMenuKeyDown}
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
            data-snooze-item="true"
            onClick={() => onSnooze(presetToIso(preset))}
            className="w-full rounded px-2 py-1 text-left text-sm hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring focus:bg-secondary"
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
          data-snooze-item="true"
          onChange={(e) => setCustomValue(e.target.value)}
          onKeyDown={(e) => {
            // Enter in the field confirms the custom value directly.
            if (e.key === "Enter" && customIso) {
              e.preventDefault();
              onSnooze(customIso);
            }
          }}
          className="w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          type="button"
          data-snooze-item="true"
          disabled={!customIso}
          onClick={() => {
            if (customIso) onSnooze(customIso);
          }}
          className="mt-1.5 w-full rounded border border-border bg-card px-2 py-1 text-xs hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          Snooze until selected
        </button>
      </div>
    </div>
  );
}
