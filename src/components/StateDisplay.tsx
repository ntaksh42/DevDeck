import { type ReactNode } from "react";
import { Loader2, AlertTriangle, WifiOff } from "lucide-react";

/** Short hints shown under empty states, pointing at the keyboard path. */
export const SEARCH_EMPTY_HINT = "Press / to focus the search box, Enter to run it.";
export const SELECT_EMPTY_HINT = "Move with ↑ ↓ in the list · Enter or → opens the preview.";

/**
 * The one empty state used by grids and previews: a line of text (plus an
 * optional keyboard hint) placed a third of the way down, so empty panes look
 * the same whether the pane is short or tall.
 */
export function PreviewEmptyState({ message, hint }: { message: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1 px-4 pb-4 pt-[12vh] text-center text-sm text-muted-foreground">
      <span>{message}</span>
      {hint ? <span className="text-xs text-muted-foreground/80">{hint}</span> : null}
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="flex min-h-64 items-center justify-center text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
      Loading
    </div>
  );
}

type ErrorKind = "auth" | "rateLimit" | "network" | "default";

function classifyError(message: string): ErrorKind {
  const lower = message.toLowerCase();
  if (lower.includes("authentication failed") || lower.includes("secret storage") || lower.includes("status 401") || lower.includes("status 403")) {
    return "auth";
  }
  if (lower.includes("rate limited") || lower.includes("status 429")) {
    return "rateLimit";
  }
  if (lower.includes("network error") || lower.includes("connection") || lower.includes("timed out") || lower.includes("dns")) {
    return "network";
  }
  return "default";
}

export function ErrorState({
  message,
  onRetry,
  onOpenSettings,
}: {
  message: string;
  /** When provided, shows a "Try again" button (network/rate-limit/default). */
  onRetry?: () => void;
  /** When provided, shows an "Open Settings" button for auth failures. */
  onOpenSettings?: () => void;
}) {
  const kind = classifyError(message);

  const variants: Record<ErrorKind, { containerCls: string; textCls: string; icon: ReactNode; hint: string }> = {
    auth: {
      containerCls: "border-warning/30 bg-warning/10",
      textCls: "text-warning",
      icon: <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />,
      hint: "Check your Personal Access Token in Settings — it may have expired.",
    },
    rateLimit: {
      containerCls: "border-warning/30 bg-warning/10",
      textCls: "text-warning",
      icon: <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />,
      hint: "Azure DevOps rate limit reached. Wait a moment, then try again.",
    },
    network: {
      containerCls: "border-border bg-muted",
      textCls: "text-muted-foreground",
      icon: <WifiOff className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
      hint: "Check your internet connection and try again.",
    },
    default: {
      containerCls: "border-destructive/30 bg-destructive/10",
      textCls: "text-destructive",
      icon: <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />,
      hint: "",
    },
  };

  const { containerCls, textCls, icon, hint } = variants[kind];

  // Auth failures point at Settings; everything else offers a retry. Buttons
  // only render when the caller wires the matching handler, so existing
  // call sites keep their message-only behavior.
  const showOpenSettings = kind === "auth" && !!onOpenSettings;
  const showRetry = !!onRetry && (kind !== "auth" || !onOpenSettings);
  const actionCls = `rounded border border-current/30 px-2 py-0.5 text-xs font-medium ${textCls} hover:bg-current/10 focus:outline-none focus:ring-2 focus:ring-ring`;

  return (
    <div role="alert" className={`flex gap-3 rounded-md border p-3 ${containerCls}`}>
      <div className="mt-0.5">{icon}</div>
      <div className="min-w-0">
        <p className={`text-sm font-medium ${textCls}`}>{message}</p>
        {hint && <p className={`mt-1 text-xs ${textCls} opacity-80`}>{hint}</p>}
        {(showOpenSettings || showRetry) && (
          <div className="mt-2 flex gap-2">
            {showOpenSettings && (
              <button type="button" onClick={onOpenSettings} className={actionCls}>
                Open Settings
              </button>
            )}
            {showRetry && (
              <button type="button" onClick={onRetry} className={actionCls}>
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
