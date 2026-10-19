import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commandErrorMessage, postAgentComment, type AgentNoteItem } from "@/lib/azdoCommands";
import { agentNoteSummariesKey } from "@/components/agent-notes/useAgentNoteSummaries";
import { workItemQueryKeys } from "@/features/work-items/queryKeys";
import type { Conversation } from "./useAgentPanelData";
import { needsApproval, pendingProposals } from "./agentProposals";
import type { AgentSubject } from "./agentSubject";

/**
 * Where a conversation's comments go. Only the subject the panel is showing
 * can be posted to: it carries the project and repository the note lacks.
 */
function locatorFor(subject: AgentSubject | null, item: AgentNoteItem) {
  if (!subject || subject.kind !== item.target || subject.id !== item.itemId) return null;
  if (subject.kind === "pull-request") {
    return {
      organizationId: subject.organizationId ?? null,
      projectId: subject.projectId,
      repositoryId: subject.repositoryId,
      threadId: subject.threadId ?? null,
    };
  }
  if (subject.kind === "work-item") {
    return { organizationId: subject.organizationId ?? null, projectId: subject.projectId };
  }
  return null;
}

/**
 * Posting of the comments agents propose in the conversations on screen: by
 * hand (`post`), and on its own when Settings allows it (`autoPost`). A
 * comment is tried automatically once per session; if the backend refuses it
 * (a link, the hourly limit) it stays for the user to approve.
 */
export function useAgentProposals(
  subject: AgentSubject | null,
  conversations: Conversation[],
  options: { autoPost: boolean; readOnly: boolean },
) {
  const queryClient = useQueryClient();
  const tried = useRef(new Set<string>());

  const post = useMutation({
    mutationFn: async ({ conversation, replyIndex, auto = false }: { conversation: Conversation; replyIndex: number; auto?: boolean }) => {
      const locator = locatorFor(subject, conversation.item);
      if (!locator) throw new Error("Select the work item / pull request this note is about to post to it");
      try {
        await postAgentComment({ ...conversation.item, noteId: conversation.note.id, replyIndex, auto, ...locator });
      } finally {
        void queryClient.invalidateQueries({ queryKey: ["agentNotes", conversation.item.target, conversation.item.itemId] });
        void queryClient.invalidateQueries({ queryKey: agentNoteSummariesKey(conversation.item.target) });
        // What the comment shows up in: the PR's conversation / the work item's comments.
        void queryClient.invalidateQueries({ queryKey: ["prReview"] });
        void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.previewRoot() });
        void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.updatesRoot() });
      }
    },
  });

  // One automatic post at a time, so the backend's limits see them in order.
  const { mutate, isPending } = post;
  useEffect(() => {
    if (!options.autoPost || options.readOnly || isPending) return;
    for (const conversation of conversations) {
      if (conversation.section !== "item" || !locatorFor(subject, conversation.item)) continue;
      for (const { index, reply } of pendingProposals(conversation.note)) {
        const key = `${conversation.key}:${index}`;
        if (tried.current.has(key) || needsApproval(reply)) continue;
        tried.current.add(key);
        mutate({ conversation, replyIndex: index, auto: true });
        return;
      }
    }
  }, [options.autoPost, options.readOnly, isPending, conversations, subject, mutate]);

  return {
    post: (conversation: Conversation, replyIndex: number) => mutate({ conversation, replyIndex }),
    busy: isPending,
    /** The last failure of a post in this conversation, as text. */
    errorFor: (key: string) =>
      post.isError && post.variables?.conversation.key === key ? commandErrorMessage(post.error) : null,
  };
}
