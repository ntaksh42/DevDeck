import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listAgentNotes, updateAgentNote, type AgentNoteItem } from "@/lib/azdoCommands";
import { agentNoteSummariesKey } from "./useAgentNoteSummaries";

// The notes query of one item (for its pins in the result) and re-attaching a
// note to a new quote. Writing, replying and resolving happen in the Agent
// panel. Mutations refresh the item's list and the grid badges.
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
  const update = useMutation({
    mutationFn: updateAgentNote,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notesKey });
      void queryClient.invalidateQueries({ queryKey: agentNoteSummariesKey(target) });
    },
  });
  return { notesQuery, update };
}
