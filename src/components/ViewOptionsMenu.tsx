import { useEffect, useRef, useState, type RefObject } from "react";
import { Check, MoreHorizontal } from "lucide-react";

export type ViewOptionsItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Keep the menu open after selecting (e.g. stepping the zoom). */
  keepOpen?: boolean;
  /** Makes the item a checkbox showing the current state of a toggle. */
  checked?: boolean;
  /** Keyboard shortcut shown at the right edge. */
  hint?: string;
};

const ITEM_SELECTOR = "[role='menuitem'],[role='menuitemcheckbox']";

// The "⋯" View options menu in a preview's dock tab strip: every action that
// isn't zoom or maximize lives here. Keyboard-operable like PrOverflowMenu:
// opens focused on the first item, ↑↓ move, Enter/Space activate, Esc closes,
// and focus returns to the trigger on close.
export function ViewOptionsMenu({
  items,
  triggerRef: externalTriggerRef,
}: {
  items: ViewOptionsItem[];
  /** Lets the owner move focus back to the trigger after a popover it opened. */
  triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const ownTriggerRef = useRef<HTMLButtonElement>(null);
  const triggerRef = externalTriggerRef ?? ownTriggerRef;
  const menuRef = useRef<HTMLDivElement>(null);

  function closeMenu() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open, triggerRef]);

  function moveFocus(delta: number) {
    const menuItems = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
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
  const left = rect ? Math.max(8, Math.min(rect.right - 224, window.innerWidth - 232)) : 8;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="View options"
        title="View options"
        disabled={items.length === 0}
        onClick={() => (open ? closeMenu() : setOpen(true))}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="View options"
          onKeyDown={handleMenuKeyDown}
          className="fixed z-50 w-56 rounded-md border border-border bg-popover p-1 shadow-lg"
          style={{ top, left }}
        >
          {/* Index keys and aria-disabled keep a focused item mounted and
              focusable while its label or availability changes. */}
          {items.map((item, index) => (
            <button
              key={index}
              type="button"
              role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={item.checked}
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
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-secondary focus:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              {item.checked === undefined ? null : (
                <Check
                  className={`h-3 w-3 shrink-0 ${item.checked ? "" : "invisible"}`}
                  aria-hidden="true"
                />
              )}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint ? (
                <kbd className="shrink-0 text-2xs text-muted-foreground">{item.hint}</kbd>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
