import { useEffect, useRef, useState } from "react";
import { Check, MoreHorizontal } from "lucide-react";
import type { PullRequestAction } from "@/lib/azdoCommands";

type OverflowProps = {
  isDraft: boolean;
  autoComplete: boolean;
  readOnly: boolean;
  pending: boolean;
  mergeStrategy: string;
  deleteSourceBranch: boolean;
  transitionWorkItems: boolean;
  onToggleDeleteSourceBranch: () => void;
  onToggleTransitionWorkItems: () => void;
  onAction: (action: PullRequestAction, confirmMessage: string) => void;
};

// Secondary PR actions (publish, auto-complete, branch/work-item toggles,
// abandon) collapsed behind a "⋯" trigger so the action row only shows the
// primary vote / merge-strategy / complete controls, matching the reference
// layout. Keyboard-operable end to end: opens focused on the first item, arrows
// move between items, Enter/Space activate, Esc closes, and focus returns to the
// trigger on close.
export function PrOverflowMenu(props: OverflowProps) {
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
        aria-label="More actions"
        onClick={() => (open ? closeMenu() : setOpen(true))}
        className="rounded border border-border bg-card px-1.5 py-0.5 text-muted-foreground hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      {open ? (
        <OverflowMenuPopup
          {...props}
          anchorRect={triggerRef.current?.getBoundingClientRect() ?? null}
          triggerRef={triggerRef}
          onClose={closeMenu}
        />
      ) : null}
    </>
  );
}

function OverflowMenuPopup({
  anchorRect,
  triggerRef,
  onClose,
  isDraft,
  autoComplete,
  readOnly,
  pending,
  mergeStrategy,
  deleteSourceBranch,
  transitionWorkItems,
  onToggleDeleteSourceBranch,
  onToggleTransitionWorkItems,
  onAction,
}: OverflowProps & {
  anchorRect: DOMRect | null;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus the first item on open so the whole flow is keyboard-driven.
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[data-menu-item="true"]')?.focus();
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
  // the preview grid behind it, even if focus slips onto <body>.
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

  function runAndClose(action: PullRequestAction, confirmMessage: string) {
    onClose();
    onAction(action, confirmMessage);
  }

  const itemClass =
    "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring focus:bg-secondary disabled:cursor-not-allowed disabled:opacity-50";
  const bottom = anchorRect ? anchorRect.bottom + 2 : 40;
  const right = anchorRect ? anchorRect.right : 240;
  const top = Math.min(bottom, window.innerHeight - 220);
  const left = Math.max(8, Math.min(right - 224, window.innerWidth - 232));

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="More actions"
      onKeyDown={handleMenuKeyDown}
      className="fixed z-50 w-56 rounded-md border border-border bg-popover p-1 shadow-lg"
      style={{ top, left }}
    >
      {isDraft ? (
        <button
          type="button"
          role="menuitem"
          data-menu-item="true"
          disabled={readOnly || pending}
          title={readOnly ? "Read-only validation mode is enabled" : undefined}
          onClick={() => runAndClose("publish", "Publish this draft pull request?")}
          className={itemClass}
        >
          Publish
        </button>
      ) : null}
      {autoComplete ? (
        <button
          type="button"
          role="menuitem"
          data-menu-item="true"
          disabled={readOnly || pending}
          title={readOnly ? "Read-only validation mode is enabled" : "Auto-complete is on"}
          onClick={() =>
            runAndClose("cancelAutoComplete", "Turn off auto-complete for this pull request?")
          }
          className={itemClass}
        >
          <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
          Auto-complete on
        </button>
      ) : (
        <button
          type="button"
          role="menuitem"
          data-menu-item="true"
          disabled={readOnly || pending}
          title={readOnly ? "Read-only validation mode is enabled" : undefined}
          onClick={() =>
            runAndClose(
              "enableAutoComplete",
              `Enable auto-complete (merge with ${mergeStrategy} once policies pass)?`,
            )
          }
          className={itemClass}
        >
          Enable auto-complete
        </button>
      )}
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={deleteSourceBranch}
        data-menu-item="true"
        disabled={readOnly || pending}
        onClick={onToggleDeleteSourceBranch}
        className={itemClass}
      >
        <span className="flex h-3.5 w-3.5 items-center justify-center" aria-hidden="true">
          {deleteSourceBranch ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
        Delete source branch
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={transitionWorkItems}
        data-menu-item="true"
        disabled={readOnly || pending}
        title="Transition linked work items to their next state on completion"
        onClick={onToggleTransitionWorkItems}
        className={itemClass}
      >
        <span className="flex h-3.5 w-3.5 items-center justify-center" aria-hidden="true">
          {transitionWorkItems ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
        Transition work items
      </button>
      <div className="my-1 border-t border-border" />
      <button
        type="button"
        role="menuitem"
        data-menu-item="true"
        disabled={readOnly || pending}
        title={readOnly ? "Read-only validation mode is enabled" : undefined}
        onClick={() => runAndClose("abandon", "Abandon this pull request?")}
        className={`${itemClass} text-destructive`}
      >
        Abandon
      </button>
    </div>
  );
}
