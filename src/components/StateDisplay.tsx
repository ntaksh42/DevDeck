import { type ReactNode } from "react";
import { Loader2, AlertTriangle, WifiOff } from "lucide-react";

export function PreviewEmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
      {message}
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

export function ErrorState({ message }: { message: string }) {
  const kind = classifyError(message);

  const variants: Record<ErrorKind, { containerCls: string; textCls: string; icon: ReactNode; hint: string }> = {
    auth: {
      containerCls: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
      textCls: "text-amber-800 dark:text-amber-300",
      icon: <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />,
      hint: "Check your Personal Access Token in Settings — it may have expired.",
    },
    rateLimit: {
      containerCls: "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/40",
      textCls: "text-yellow-800 dark:text-yellow-300",
      icon: <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-400" aria-hidden="true" />,
      hint: "Azure DevOps rate limit reached. Wait a moment, then try again.",
    },
    network: {
      containerCls: "border-gray-200 bg-gray-50 dark:border-border dark:bg-muted",
      textCls: "text-gray-700 dark:text-muted-foreground",
      icon: <WifiOff className="h-4 w-4 shrink-0 text-gray-500 dark:text-muted-foreground" aria-hidden="true" />,
      hint: "Check your internet connection and try again.",
    },
    default: {
      containerCls: "border-destructive/30 bg-red-50 dark:bg-red-950/40",
      textCls: "text-destructive",
      icon: <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />,
      hint: "",
    },
  };

  const { containerCls, textCls, icon, hint } = variants[kind];

  return (
    <div role="alert" className={`flex gap-3 rounded-md border p-3 ${containerCls}`}>
      <div className="mt-0.5">{icon}</div>
      <div>
        <p className={`text-sm font-medium ${textCls}`}>{message}</p>
        {hint && <p className={`mt-1 text-xs ${textCls} opacity-80`}>{hint}</p>}
      </div>
    </div>
  );
}
