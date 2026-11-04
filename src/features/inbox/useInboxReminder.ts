import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearReplyReminder,
  commandErrorMessage,
  listReplyReminders,
  setReplyReminder,
  type ReplyReminder,
} from "@/lib/azdoCommands";
import { pushToast } from "@/lib/toast";
import { isPullRequestItem, type InboxEntry } from "./inboxPresentation";

/** The conversation a reminder watches: a PR thread, or a work item (no repository, thread 0). */
function conversationOf(entry: InboxEntry) {
  const pr = isPullRequestItem(entry);
  return {
    kind: pr ? ("pr" as const) : ("wi" as const),
    repositoryId: pr ? entry.repositoryId : "",
    threadId: pr ? entry.threadId : 0,
  };
}

/**
 * "Remind me if no one replies" for the selected Inbox entry (key W). The
 * reminder lives in the local database; the sync clears it when someone
 * comments on the conversation and raises a Waiting row if the deadline
 * passes first. The query key sits under `actionInbox`, so every Inbox update
 * refreshes it.
 */
export function useInboxReminder(selected: InboxEntry | null) {
  const queryClient = useQueryClient();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const remindersQuery = useQuery({
    queryKey: ["actionInbox", "reminders"],
    queryFn: listReplyReminders,
  });
  const existing: ReplyReminder | undefined = selected
    ? remindersQuery.data?.find((reminder) => {
        const conversation = conversationOf(selected);
        return (
          reminder.organizationId === selected.organizationId &&
          reminder.subjectId === selected.subjectId &&
          reminder.kind === conversation.kind &&
          reminder.repositoryId === conversation.repositoryId &&
          reminder.threadId === conversation.threadId
        );
      })
    : undefined;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["actionInbox", "reminders"] });
  const setMutation = useMutation({
    mutationFn: (input: { entry: InboxEntry; dueAt: string }) =>
      setReplyReminder({
        organizationId: input.entry.organizationId,
        subjectId: input.entry.subjectId,
        projectId: input.entry.projectId,
        projectName: input.entry.projectName,
        repositoryName: input.entry.repositoryName,
        title: input.entry.title,
        webUrl: input.entry.webUrl,
        dueAt: input.dueAt,
        ...conversationOf(input.entry),
      }),
    onSuccess: (reminder) => {
      void refresh();
      pushToast(`Reminder set for ${new Date(reminder.dueAt).toLocaleString()} if no one replies`);
    },
    onError: (error) => pushToast(`Could not set the reminder: ${commandErrorMessage(error)}`),
  });
  const clearMutation = useMutation({
    mutationFn: clearReplyReminder,
    onSuccess: () => {
      void refresh();
      pushToast("Reminder cancelled");
    },
    onError: (error) => pushToast(`Could not cancel the reminder: ${commandErrorMessage(error)}`),
  });

  return {
    anchor,
    open: setAnchor,
    close: () => setAnchor(null),
    existing,
    set: (entry: InboxEntry, dueAt: string) => {
      setAnchor(null);
      setMutation.mutate({ entry, dueAt });
    },
    cancel: (reminder: ReplyReminder) => {
      setAnchor(null);
      clearMutation.mutate(reminder.id);
    },
  };
}
