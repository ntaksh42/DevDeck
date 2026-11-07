import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAppSettings, listAutoQueue } from "@/lib/azdoCommands";
import { AutoQueueView } from "./AutoQueueView";
import { addSkipped, loadSkipped } from "./autoQueueSkipped";

// Set once the user picked or skipped in the startup dialog; lasts until the
// app is restarted, when the first scan holds its candidates back again.
let decidedThisLaunch = false;

const FOCUSABLE = "button:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * Right after startup the first automatic scan holds its candidates back (see
 * `auto_agent::HELD`). This dialog blocks the app until the user runs some of
 * them or skips them, so nothing is left waiting unnoticed.
 */
export function AutoQueueStartupGate() {
  const [decided, setDecided] = useState(decidedThisLaunch);
  const settingsQuery = useQuery({ queryKey: ["appSettings"], queryFn: getAppSettings });
  const enabled = settingsQuery.data?.autoAgentEnabled === true && !decided;
  const queueQuery = useQuery({
    queryKey: ["autoQueue"],
    queryFn: listAutoQueue,
    enabled,
    refetchInterval: 5_000,
  });
  const dialogRef = useRef<HTMLDivElement>(null);

  const skipped = loadSkipped();
  const waiting = (queueQuery.data ?? []).filter((item) => item.held && !skipped.includes(`${item.organizationId}:${item.target}:${item.id}`));
  const open = enabled && waiting.length > 0;

  // Keys pressed while focus is outside the dialog must not reach the app.
  useEffect(() => {
    if (!open) return;
    const block = (event: globalThis.KeyboardEvent) => {
      if (!dialogRef.current?.contains(event.target as Node)) {
        event.preventDefault();
        event.stopPropagation();
        dialogRef.current?.focus();
      }
    };
    window.addEventListener("keydown", block, true);
    return () => window.removeEventListener("keydown", block, true);
  }, [open]);

  if (!open) return null;

  function decide() {
    decidedThisLaunch = true;
    setDecided(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (first && last) {
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    // Escape does not close it, and no shortcut of the app runs behind it.
    event.stopPropagation();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Choose what the agent handles"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="flex h-[80vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl"
      >
        <div className="border-b border-border px-4 py-2 text-sm">
          <b>Choose what the agent handles.</b> {waiting.length} found at startup. Run the ones you want, or skip them,
          before continuing.
        </div>
        <div className="min-h-0 flex-1">
          <AutoQueueView onDecided={decide} />
        </div>
        <div className="flex justify-end border-t border-border px-4 py-2">
          <button
            type="button"
            className="rounded border border-border px-3 py-1 text-sm hover:bg-muted"
            onClick={() => {
              addSkipped(loadSkipped(), waiting);
              decide();
            }}
          >
            Skip all and continue
          </button>
        </div>
      </div>
    </div>
  );
}
