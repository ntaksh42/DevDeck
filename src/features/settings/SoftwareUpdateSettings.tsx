import { useEffect, useRef, useState } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { isTauriRuntime } from "@/lib/runtime";
import {
  checkForUpdate,
  installUpdateAndRelaunch,
  type AvailableUpdate,
} from "@/lib/softwareUpdate";
import { useExperimentalFlag } from "./useExperimentalFlags";
import { SettingsRow } from './SettingsRow';

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
  const autoCheck = useExperimentalFlag("autoUpdateCheck");
  const autoChecked = useRef(false);

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

  // Experimental: check once per mount instead of waiting for the button. The
  // ref keeps a settings refetch from re-triggering the check.
  useEffect(() => {
    if (!supported || !autoCheck || autoChecked.current) {
      return;
    }
    autoChecked.current = true;
    void check();
  }, [supported, autoCheck]);

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
    <SettingsRow
      title="Software update"
      description={<>Check for a newer release and install it. Opt-in — nothing is downloaded until you check.</>}
    >
      <div className="flex flex-wrap items-center gap-3">
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
    </SettingsRow>
  );
}
