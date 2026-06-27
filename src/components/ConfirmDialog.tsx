import { useEffect, useRef } from "react";

/**
 * In-app confirmation modal for destructive actions, replacing window.confirm so
 * the dialog matches the app theme and keyboard model. role="alertdialog" with
 * Escape to cancel, initial focus on the cancel button (the safe default), and
 * focus returned to the element that opened it on close.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Remember the opener so focus returns there on close.
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => {
      window.setTimeout(() => opener?.focus(), 0);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-md border border-border bg-card p-4 shadow-lg"
      >
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-md px-3 py-1.5 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-ring ${
              destructive
                ? "bg-destructive hover:bg-destructive/90"
                : "bg-primary hover:bg-primary/90"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
