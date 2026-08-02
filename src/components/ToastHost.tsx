import { useEffect, useSyncExternalStore } from "react";
import {
  dismissToast,
  getSnapshot,
  subscribe,
  type Toast,
} from "@/lib/toast";
import { useExperimentalFlag } from "@/features/settings/useExperimentalFlags";

function ToastRow({ toast }: { toast: Toast }) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-foreground px-3 py-2 text-sm text-background shadow-lg">
      <span className="min-w-0">{toast.message}</span>
      <div className="flex shrink-0 gap-1">
        {toast.onRetry ? (
          <button
            type="button"
            onClick={() => {
              dismissToast(toast.id);
              toast.onRetry?.();
            }}
            className="rounded border border-background/30 px-2 py-0.5 text-xs font-medium hover:bg-background/10 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Retry
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => dismissToast(toast.id)}
          className="rounded border border-background/30 px-2 py-0.5 text-xs font-medium hover:bg-background/10 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

/**
 * Renders retry toasts raised through `@/lib/toast`. Experimental: with the
 * flag off this renders nothing, so failures keep their existing handling.
 */
export function ToastHost() {
  const toasts = useSyncExternalStore(subscribe, getSnapshot);

  if (toasts.length === 0) {
    return null;
  }
  return <ToastList toasts={toasts} />;
}

// Split so the settings query only runs once something has actually raised a
// toast. Querying from the shell on every mount would add an app-startup
// request for a feature that is off by default.
function ToastList({ toasts }: { toasts: Toast[] }) {
  const enabled = useExperimentalFlag("retryToasts");

  // Escape dismisses the newest toast so a keyboard user is never stuck with
  // one covering the corner of the grid.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        dismissToast(toasts[toasts.length - 1].id);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, toasts]);

  if (!enabled) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
