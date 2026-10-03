import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

export type ToolbarMenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Keep the menu open after selecting (e.g. stepping the zoom). */
  keepOpen?: boolean;
};

// The PR review toolbar folded behind "⋯" when the tab strip is too narrow
// for the tabs and every icon. Keyboard-operable like PrOverflowMenu: opens
// focused on the first item, ↑↓ move, Enter/Space activate, Esc closes, and
// focus returns to the trigger on close.
export function PrReviewToolbarMenu({ items }: { items: ToolbarMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function closeMenu() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  function moveFocus(delta: number) {
    const menuItems = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [],
    );
    if (menuItems.length === 0) return;
    const current = menuItems.indexOf(document.activeElement as HTMLElement);
    menuItems[(current + delta + menuItems.length) % menuItems.length]?.focus();
  }

  function handleMenuKeyDown(e: React.KeyboardEvent) {
    // Keep navigation keys inside the menu so the grid/preview don't react.
    e.stopPropagation();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    }
  }

  const rect = open ? triggerRef.current?.getBoundingClientRect() : null;
  const top = rect ? rect.bottom + 2 : 40;
  const left = rect ? Math.max(8, Math.min(rect.right - 192, window.innerWidth - 200)) : 8;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="View options"
        title="View options"
        onClick={() => (open ? closeMenu() : setOpen(true))}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="View options"
          onKeyDown={handleMenuKeyDown}
          className="fixed z-50 w-48 rounded-md border border-border bg-popover p-1 shadow-lg"
          style={{ top, left }}
        >
          {/* Index keys and aria-disabled keep a focused item mounted and
              focusable while its label (zoom %) or availability changes. */}
          {items.map((item, index) => (
            <button
              key={index}
              type="button"
              role="menuitem"
              aria-disabled={item.disabled || undefined}
              onClick={() => {
                if (item.disabled) return;
                if (item.keepOpen) {
                  item.onSelect();
                } else {
                  closeMenu();
                  item.onSelect();
                }
              }}
              className="flex w-full items-center rounded px-2 py-1 text-left text-xs hover:bg-secondary focus:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
