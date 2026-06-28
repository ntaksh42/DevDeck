import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

type Props = { children: ReactNode };
type State = { error: Error | null };

// Top-level boundary so a render-time exception shows the error instead of a
// blank window. Module-evaluation errors (e.g. an import cycle TDZ) die before
// React mounts and cannot be caught here; main.tsx logs those to the console.
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("AppErrorBoundary caught a render error", error, info);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-screen items-center justify-center bg-background p-6 text-foreground">
        <div
          role="alert"
          className="max-w-xl rounded-md border border-destructive/30 bg-red-50 p-4 dark:bg-red-950/40"
        >
          <div className="flex gap-3">
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-destructive">
                Something went wrong while rendering DevDeck.
              </p>
              <p className="mt-1 break-words text-sm text-destructive">{error.message}</p>
              {error.stack && (
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-background/60 p-2 text-xs text-muted-foreground">
                  {error.stack}
                </pre>
              )}
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent"
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
