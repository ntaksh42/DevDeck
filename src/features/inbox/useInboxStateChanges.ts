import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { commandErrorMessage, setActionInboxItemState } from "@/lib/azdoCommands";
import { pushToast } from "@/lib/toast";
import type { InboxEntry, InboxTab } from "./inboxPresentation";

/** How long the last state change can be undone with `U`. */
export const INBOX_UNDO_WINDOW_MS = 10_000;

export type InboxUndo = {
  /** Every item the change touched, each with the wake time it had before. */
  items: { id: number; previousSnoozedUntil: string | null }[];
  /** The state the items had before the change, restored by undo. */
  previous: InboxTab;
  /** What the change did, shown in the status bar (e.g. "Marked done"). */
  label: string;
};

function changeLabel(state: InboxTab, resolved: boolean, count: number): string {
  const suffix = count > 1 ? ` (${count})` : "";
  if (resolved) return "Resolved + done";
  if (state === "done") return `Marked done${suffix}`;
  if (state === "snoozed") return `Snoozed${suffix}`;
  return `Moved to Open${suffix}`;
}

/**
 * Local Done / Snooze / Reopen for stored Inbox items.
 *
 * A changed item leaves the visible list at once (instead of after the refetch),
 * so the row under it takes the selection and the user can keep going. The last
 * change can be undone for a short while; undo restores only the Inbox state
 * (a thread resolved on Azure DevOps stays resolved).
 */
export function useInboxStateChanges({
  entries,
  tab,
  onReselect,
}: {
  entries: InboxEntry[];
  tab: InboxTab;
  /** Selects a visible row: the undone item once the refetched list has it back. */
  onReselect: (index: number) => void;
}) {
  const queryClient = useQueryClient();
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<number>>(new Set());
  const [undo, setUndo] = useState<InboxUndo | null>(null);
  const [reselectId, setReselectId] = useState<number | null>(null);
  const undoTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
  }, []);

  // The undo belongs to the list it was made in.
  useEffect(() => clearUndo(), [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  function clearUndo() {
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setUndo(null);
  }

  function hide(id: number, hidden: boolean) {
    setHiddenIds((current) => {
      const next = new Set(current);
      if (hidden) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // Called directly rather than through useMutation: mutate-level callbacks only
  // fire for the latest call, and E pressed on several rows in a row must
  // unhide each one once its own refetch lands.
  function send(ids: number[], state: InboxTab, snoozedUntil: string | undefined, onFailure: () => void) {
    void setActionInboxItemState({ ids, state, snoozedUntil })
      .catch((error: unknown) => {
        onFailure();
        pushToast(`Could not update the Inbox item: ${commandErrorMessage(error)}`);
      })
      .then(() => queryClient.invalidateQueries({ queryKey: ["actionInbox"] }))
      // The refetched list no longer has them (or has them back); stop hiding.
      .finally(() => ids.forEach((id) => hide(id, false)));
  }

  /** Moves an item to `state`. */
  function changeState(
    entry: InboxEntry,
    state: InboxTab,
    snoozedUntil?: string,
    options: { resolved?: boolean } = {},
  ) {
    changeStates([entry], state, snoozedUntil, options);
  }

  /** Moves several items to `state` in one request; undo restores them together. */
  function changeStates(
    targets: InboxEntry[],
    state: InboxTab,
    snoozedUntil?: string,
    options: { resolved?: boolean } = {},
  ) {
    if (targets.length === 0) return;
    const ids = targets.map((entry) => entry.id);
    const record: InboxUndo = {
      items: targets.map((entry) => ({ id: entry.id, previousSnoozedUntil: entry.snoozedUntil })),
      previous: tab,
      label: changeLabel(state, options.resolved ?? false, targets.length),
    };
    if (state !== tab) ids.forEach((id) => hide(id, true));
    send(ids, state, snoozedUntil, () => {
      ids.forEach((id) => hide(id, false));
      setUndo((current) => (current === record ? null : current));
    });
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
    setUndo(record);
    undoTimer.current = window.setTimeout(() => {
      setUndo(null);
      undoTimer.current = null;
    }, INBOX_UNDO_WINDOW_MS);
  }

  /** Restores the state the last changed item had. Returns false when there is nothing to undo. */
  function undoLast(): boolean {
    const record = undo;
    if (!record) return false;
    clearUndo();
    setReselectId(record.items[0].id);
    // Items that had different wake times go back in one request per wake time.
    const byWakeTime = new Map<string | null, number[]>();
    for (const { id, previousSnoozedUntil } of record.items) {
      hide(id, false);
      byWakeTime.set(previousSnoozedUntil, [...(byWakeTime.get(previousSnoozedUntil) ?? []), id]);
    }
    for (const [wakeTime, ids] of byWakeTime) {
      send(ids, record.previous, wakeTime ?? undefined, () => setReselectId(null));
    }
    return true;
  }

  const visibleEntries = useMemo(
    () => (hiddenIds.size === 0 ? entries : entries.filter((entry) => !hiddenIds.has(entry.id))),
    [entries, hiddenIds],
  );

  useEffect(() => {
    if (reselectId === null) return;
    const target = visibleEntries.findIndex((entry) => entry.id === reselectId);
    if (target < 0) return;
    setReselectId(null);
    onReselect(target);
  }, [visibleEntries, reselectId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { visibleEntries, changeState, changeStates, undo, undoLast };
}
