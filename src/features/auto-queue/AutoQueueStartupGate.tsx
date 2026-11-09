import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { autoQueueKey, getAppSettings, listAutoQueue, type AutoQueueTarget } from "@/lib/azdoCommands";
import { AutoQueueView } from "./AutoQueueView";

// Set once every held item was run or skipped in the startup dialog; lasts
// until the app is restarted, when the first scan holds its candidates back again.
let decidedThisLaunch = false;

/** Forgets the decision so each test starts like a fresh launch. */
export function resetStartupGateForTests() {
  decidedThisLaunch = false;
}

const FOCUSABLE = "button:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * Right after startup the first automatic scan holds its candidates back (see
 * `auto_agent::HELD`). This dialog blocks the app until the user runs some of
 * them or skips them, so nothing is left waiting unnoticed.
 */
export function AutoQueueStartupGate() {
  const [decided, setDecided] = useState(decidedThisLaunch);
  // Items run or skipped in this dialog. Skips are not persisted: an item skipped
  // here is held again, and asked about again, at the next start.
  const [decidedKeys, setDecidedKeys] = useState<string[]>([]);
  const settingsQuery = useQuery({ queryKey: ["appSettings"], queryFn: getAppSettings });
  const enabled = settingsQuery.data?.autoAgentEnabled === true && !decided;
  const queueQuery = useQuery({
    queryKey: ["autoQueue"],
    queryFn: listAutoQueue,
    enabled,
    refetchInterval: 5_000,
  });
  const dialogRef = useRef<HTMLDivElement>(null);

  const waiting = (queueQuery.data ?? []).filter((item) => item.held && !decidedKeys.includes(autoQueueKey(item)));
  const open = enabled && waiting.length > 0;

  // The dialog stays until every held item was run or skipped. Nothing held at
  // the first scan also ends it, so a candidate that turns up hours later goes
  // to the Auto Queue view instead of blocking the app as a "startup" dialog.
  useEffect(() => {
    if (enabled && queueQuery.isSuccess && waiting.length === 0) {
      decidedThisLaunch = true;
      setDecided(true);
    }
  }, [enabled, queueQuery.isSuccess, waiting.length]);

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

  function decide(targets: AutoQueueTarget[]) {
    const keys = targets.map(autoQueueKey);
    setDecidedKeys((current) => [...new Set([...current, ...keys])]);
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
          <AutoQueueView onDecided={decide} sessionOnly />
        </div>
        <div className="flex justify-end border-t border-border px-4 py-2">
          <button
            type="button"
            className="rounded border border-border px-3 py-1 text-sm hover:bg-muted"
            onClick={() => {
              decide(waiting);
            }}
          >
            Skip all and continue
          </button>
        </div>
      </div>
    </div>
  );
}
