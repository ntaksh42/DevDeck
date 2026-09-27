import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Copy, Download, MoreHorizontal, Trash2, Upload } from "lucide-react";

type WorkItemViewsOverflowMenuProps = {
  hasSelectedView: boolean;
  hasViews: boolean;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  onShare: () => void;
  onExport: () => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onDelete: () => void;
};

// Low-frequency view actions (share/export/import/delete) collapsed behind a
// "⋯" trigger so the toolbar leads with the controls used every time (layout,
// pin, move, preview, edit, run, add). Keyboard-operable end to end: opens
// focused on the first item, arrows move between items, Enter/Space activate,
// Esc closes, and focus returns to the trigger on close.
export function WorkItemViewsOverflowMenu({
  hasSelectedView,
  hasViews,
  importInputRef,
  onShare,
  onExport,
  onImport,
  onDelete,
}: WorkItemViewsOverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function closeMenu() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More view actions"
        title="More view actions"
        onClick={() => (open ? closeMenu() : setOpen(true))}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-secondary"
      >
        <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => void onImport(event)}
      />
      {open ? (
        <OverflowMenuPopup
          triggerRef={triggerRef}
          anchorRect={triggerRef.current?.getBoundingClientRect() ?? null}
          onClose={closeMenu}
          hasSelectedView={hasSelectedView}
          hasViews={hasViews}
          importInputRef={importInputRef}
          onShare={onShare}
          onExport={onExport}
          onDelete={onDelete}
        />
      ) : null}
    </>
  );
}

function OverflowMenuPopup({
  anchorRect,
  triggerRef,
  onClose,
  hasSelectedView,
  hasViews,
  importInputRef,
  onShare,
  onExport,
  onDelete,
}: {
  anchorRect: DOMRect | null;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  hasSelectedView: boolean;
  hasViews: boolean;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  onShare: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus the first item on open so the whole flow is keyboard-driven.
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[data-menu-item="true"]:not(:disabled)')?.focus();
  }, []);

  // Close when clicking outside both the menu and its trigger (so the trigger's
  // own toggle click isn't immediately undone by this listener).
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose, triggerRef]);

  // Capture-phase guard: while the menu is open, no navigation key should reach
  // the view list or grid behind it, even if focus slips onto <body>.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (menuRef.current?.contains(e.target as Node)) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        moveFocus(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        moveFocus(-1);
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  function moveFocus(delta: number) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[data-menu-item="true"]') ?? [],
    ).filter((el) => !el.hasAttribute("disabled"));
    if (items.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const current = active ? items.indexOf(active) : -1;
    const next = (current + delta + items.length) % items.length;
    items[next]?.focus();
  }

  function handleMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      moveFocus(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      moveFocus(-1);
    } else if (e.key === "Enter" || e.key === " ") {
      // Let the focused button's own click fire; just keep it off the grid.
      e.stopPropagation();
    }
  }

  function runAndClose(action: () => void) {
    onClose();
    action();
  }

  const itemClass =
    "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring focus:bg-secondary disabled:cursor-not-allowed disabled:opacity-50";
  const bottom = anchorRect ? anchorRect.bottom + 2 : 40;
  const right = anchorRect ? anchorRect.right : 240;
  const top = Math.min(bottom, window.innerHeight - 180);
  const left = Math.max(8, Math.min(right - 224, window.innerWidth - 232));

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="More view actions"
      onKeyDown={handleMenuKeyDown}
      className="fixed z-50 w-56 rounded-md border border-border bg-popover p-1 shadow-lg"
      style={{ top, left }}
    >
      <button
        type="button"
        role="menuitem"
        data-menu-item="true"
        disabled={!hasSelectedView}
        onClick={() => runAndClose(onShare)}
        className={itemClass}
      >
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        Copy share JSON
      </button>
      <button
        type="button"
        role="menuitem"
        data-menu-item="true"
        disabled={!hasViews}
        onClick={() => runAndClose(onExport)}
        className={itemClass}
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
        Export all views
      </button>
      <button
        type="button"
        role="menuitem"
        data-menu-item="true"
        onClick={() => runAndClose(() => importInputRef.current?.click())}
        className={itemClass}
      >
        <Upload className="h-3.5 w-3.5" aria-hidden="true" />
        Import views…
      </button>
      <div className="my-1 border-t border-border" />
      <button
        type="button"
        role="menuitem"
        data-menu-item="true"
        disabled={!hasSelectedView}
        aria-keyshortcuts="Delete"
        onClick={() => runAndClose(onDelete)}
        className={`${itemClass} hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive`}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        Delete view (Del)
      </button>
    </div>
  );
}
