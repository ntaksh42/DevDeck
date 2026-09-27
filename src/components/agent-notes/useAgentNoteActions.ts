import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  commandErrorMessage,
  createAgentNote,
  deleteAgentNote,
  listAgentNotes,
  replyAgentNote,
  restoreAgentNote,
  runAgent,
  setAgentNoteStatus,
  submitAgentNoteDrafts,
  updateAgentNote,
  type AgentNote,
  type AgentNoteItem,
} from "@/lib/azdoCommands";
import { agentNoteSummariesKey } from "./useAgentNoteSummaries";

const UNDO_MS = 6_000;

export type DeletedNote = { id: string; status: "open" | "draft" };

// The notes query and every note mutation for one item. Mutations refresh
// the item's list and the grid badges.
export function useAgentNoteActions(item: AgentNoteItem, enabled: boolean) {
  const { target, itemId } = item;
  const queryClient = useQueryClient();
  const notesKey = ["agentNotes", target, itemId];
  // The app-wide watcher refreshes this as soon as the files change; the
  // slow poll is only a fallback.
  const notesQuery = useQuery({
    queryKey: notesKey,
    queryFn: () => listAgentNotes({ target, itemId }),
    enabled,
    refetchInterval: 60_000,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: notesKey });
    void queryClient.invalidateQueries({ queryKey: agentNoteSummariesKey(target) });
  };

  const create = useMutation({ mutationFn: createAgentNote, onSuccess: refresh });
  const reply = useMutation({
    mutationFn: ({ noteId, body }: { noteId: string; body: string }) =>
      replyAgentNote({ target, itemId, noteId, body }),
    onSuccess: refresh,
  });
  const update = useMutation({ mutationFn: updateAgentNote, onSuccess: refresh });
  const setStatus = useMutation({
    mutationFn: ({ noteId, status }: { noteId: string; status: "open" | "done" }) =>
      setAgentNoteStatus({ target, itemId, noteId, status }),
    onSuccess: refresh,
  });
  const submitDrafts = useMutation({
    mutationFn: () => submitAgentNoteDrafts({ target, itemId }),
    onSuccess: refresh,
  });
  const run = useMutation({ mutationFn: () => runAgent({ target, itemId }) });

  // Delete moves the file to the trash; the last delete can be undone for a
  // few seconds.
  const [deleted, setDeleted] = useState<DeletedNote | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(undoTimer.current), []);
  useEffect(() => setDeleted(null), [target, itemId]);
  const remove = useMutation({
    mutationFn: (note: AgentNote) => deleteAgentNote({ target, itemId, noteId: note.id }),
    onSuccess: (_, note) => {
      refresh();
      setDeleted({ id: note.id, status: note.status === "draft" ? "draft" : "open" });
      window.clearTimeout(undoTimer.current);
      undoTimer.current = window.setTimeout(() => setDeleted(null), UNDO_MS);
    },
  });
  const restore = useMutation({
    mutationFn: (note: DeletedNote) => restoreAgentNote({ target, itemId, noteId: note.id, status: note.status }),
    onSuccess: () => {
      setDeleted(null);
      refresh();
    },
  });

  const failed = [notesQuery, create, reply, update, setStatus, submitDrafts, run, remove, restore].find(
    (state) => state.error,
  );
  return {
    notesQuery,
    create,
    reply,
    update,
    setStatus,
    submitDrafts,
    run,
    remove,
    restore,
    deleted,
    undoDelete: () => deleted && restore.mutate(deleted),
    error: failed?.error ? commandErrorMessage(failed.error) : null,
  };
}

export type AgentNoteActions = ReturnType<typeof useAgentNoteActions>;
