import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

// Inline replacement for window.confirm: a one-line bar under the run header.
// Focus starts on the safe choice (Keep); Esc or Keep closes it and the owner
// puts focus back on the button that opened it.
export function PipelineConfirmBar({
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  function handleKeyDown(event: ReactKeyboardEvent) {
    // Keep the preview's own Esc/arrow handling (focus back to the grid) out of it.
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.stopPropagation();
    }
  }

  return (
    <div
      role="alertdialog"
      aria-label={message}
      onKeyDown={handleKeyDown}
      className="flex items-center gap-2 border-y border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
    >
      <span className="min-w-0 flex-1">{message}</span>
      <button
        ref={cancelRef}
        type="button"
        onClick={onCancel}
        className="inline-flex h-6 items-center rounded-md border border-border bg-card px-2 text-xs text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {cancelLabel}
      </button>
      <button
        type="button"
        onClick={onConfirm}
        className="inline-flex h-6 items-center rounded-md bg-red-600 px-2 text-xs font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {confirmLabel}
      </button>
    </div>
  );
}
