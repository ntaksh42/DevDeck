import { useState } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { isTauriRuntime } from "@/lib/runtime";
import {
  checkForUpdate,
  installUpdateAndRelaunch,
  type AvailableUpdate,
} from "@/lib/softwareUpdate";

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "available"; update: AvailableUpdate }
  | { kind: "installing" }
  | { kind: "error"; message: string };

export function SoftwareUpdateSettings() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const supported = isTauriRuntime();

  async function check() {
    setStatus({ kind: "checking" });
    try {
      const update = await checkForUpdate();
      setStatus(update ? { kind: "available", update } : { kind: "upToDate" });
    } catch (error) {
      // Safe skip: a failed check leaves the current version running.
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not check for updates.",
      });
    }
  }

  async function install() {
    setStatus({ kind: "installing" });
    try {
      await installUpdateAndRelaunch();
      // On success the app relaunches; if it returns, treat as done.
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Update failed.",
      });
    }
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Download className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Software update</h2>
            <p className="text-sm text-muted-foreground">
              Check for a newer release and install it. Opt-in — nothing is
              downloaded until you check.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 p-3">
        {!supported ? (
          <p className="text-sm text-muted-foreground">
            Updates are available in the installed desktop app.
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={check}
              disabled={status.kind === "checking" || status.kind === "installing"}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-secondary disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${status.kind === "checking" ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              Check for updates
            </button>

            {status.kind === "available" ? (
              <button
                type="button"
                onClick={install}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download &amp; restart ({status.update.version})
              </button>
            ) : null}

            {status.kind === "installing" ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Installing…
              </span>
            ) : null}

            {status.kind === "upToDate" ? (
              <span className="text-sm text-muted-foreground">You're on the latest version.</span>
            ) : null}

            {status.kind === "available" && status.update.notes ? (
              <p className="w-full whitespace-pre-wrap text-xs text-muted-foreground">
                {status.update.notes}
              </p>
            ) : null}

            {status.kind === "error" ? (
              <p role="alert" className="w-full text-sm text-destructive">
                {status.message}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
