import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { commandErrorMessage, setActionInboxItemState } from "@/lib/azdoCommands";
import { pushToast } from "@/lib/toast";
import type { InboxEntry, InboxTab } from "./inboxPresentation";

/** How long the last state change can be undone with `U`. */
export const INBOX_UNDO_WINDOW_MS = 10_000;

export type InboxUndo = {
  id: number;
  /** The state the item had before the change, restored by undo. */
  previous: InboxTab;
  previousSnoozedUntil: string | null;
  /** What the change did, shown in the status bar (e.g. "Marked done"). */
  label: string;
};

function changeLabel(state: InboxTab, resolved: boolean): string {
  if (resolved) return "Resolved + done";
  if (state === "done") return "Marked done";
  if (state === "snoozed") return "Snoozed";
  return "Moved to Open";
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
  // The last write queued per item. Writes for one item run one after another:
  // an undo pressed while the change it undoes is still being saved must not
  // race it, or the older write (and its refetch) could land last.
  const pendingWrites = useRef(new Map<number, Promise<unknown>>());

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
  function send(id: number, state: InboxTab, snoozedUntil: string | undefined, onFailure: () => void) {
    const previous = pendingWrites.current.get(id) ?? Promise.resolve();
    const write = previous
      .then(() => setActionInboxItemState({ ids: [id], state, snoozedUntil }))
      .catch((error: unknown) => {
        onFailure();
        pushToast(`Could not update the Inbox item: ${commandErrorMessage(error)}`);
      })
      .then(() => queryClient.invalidateQueries({ queryKey: ["actionInbox"] }))
      // The refetched list no longer has it (or has it back); stop hiding.
      .finally(() => {
        hide(id, false);
        if (pendingWrites.current.get(id) === write) pendingWrites.current.delete(id);
      });
    pendingWrites.current.set(id, write);
  }

  /** Moves an item to `state`. */
  function changeState(
    entry: InboxEntry,
    state: InboxTab,
    snoozedUntil?: string,
    options: { resolved?: boolean } = {},
  ) {
    const record: InboxUndo = {
      id: entry.id,
      previous: tab,
      previousSnoozedUntil: entry.snoozedUntil,
      label: changeLabel(state, options.resolved ?? false),
    };
    if (state !== tab) hide(entry.id, true);
    send(entry.id, state, snoozedUntil, () => {
      hide(entry.id, false);
      setUndo((current) => (current?.id === entry.id ? null : current));
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
    // Stays hidden until the restoring write's refetch brings it back; showing
    // it from the current list would let a refetch for the change being undone
    // remove it again (and move the selection) a moment later.
    hide(record.id, true);
    setReselectId(record.id);
    send(record.id, record.previous, record.previousSnoozedUntil ?? undefined, () => setReselectId(null));
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

  return { visibleEntries, changeState, undo, undoLast };
}
