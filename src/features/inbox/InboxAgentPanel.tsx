import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import {
  commandErrorMessage,
  getAppSettings,
  noteNeedsYou,
  runAgent,
  type AgentNote,
} from "@/lib/azdoCommands";
import { MarkdownView } from "@/lib/markdown";
import { formatRelativeDate } from "@/lib/utils";
import { PreviewBand } from "@/components/PreviewBand";
import { ErrorState, LoadingState } from "@/components/StateDisplay";
import { useAgentNoteActions } from "@/components/agent-notes/useAgentNoteActions";
import { CommentComposer } from "@/features/pull-requests/CommentComposer";
import { agentItemOf, type InboxEntry } from "./inboxPresentation";

/** One message of the conversation: the user's note or an agent / user reply. */
function Message({
  author,
  when,
  text,
  quote,
}: {
  author: string;
  when: string;
  text: string;
  quote?: string | null;
}) {
  const mine = author === "user";
  return (
    <div className={`rounded border px-2 py-1 ${mine ? "border-border" : "border-violet-300 bg-violet-50/40 dark:border-violet-900 dark:bg-violet-950/20"}`}>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">{mine ? "You" : `@${author}`}</span>
        <span>{formatRelativeDate(when)}</span>
      </div>
      {quote ? (
        <blockquote className="my-0.5 border-l-2 border-border pl-2 text-xs text-muted-foreground">
          {quote}
        </blockquote>
      ) : null}
      <MarkdownView text={text} className="text-xs text-foreground" />
    </div>
  );
}

/**
 * The conversation with the external agent about one pull request / work item,
 * shown as a thread. A question becomes a `question` note (quoting the comment
 * that prompted it) and starts the configured agent command; the agent's
 * answers arrive as replies on the same note.
 */
export function InboxAgentPanel({
  entry,
  readOnly,
  askRequest,
  onAskHandled,
  onReturnToList,
}: {
  entry: InboxEntry | null;
  readOnly: boolean;
  /** True after the user asked (Q) so the composer takes focus once mounted. */
  askRequest: boolean;
  onAskHandled: () => void;
  onReturnToList: () => void;
}) {
  const item = entry ? agentItemOf(entry) : null;
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const settings = settingsQuery.data;
  const actions = useAgentNoteActions(
    item ?? { target: "pull-request", itemId: 0 },
    item !== null,
  );
  const composerRef = useRef<HTMLDivElement | null>(null);

  // The panel may only just have been brought to the front of its dock group.
  useEffect(() => {
    if (!askRequest) return;
    const textarea = composerRef.current?.querySelector("textarea");
    if (!textarea) return;
    textarea.focus();
    onAskHandled();
  });

  const run = useMutation({
    mutationFn: () =>
      runAgent({
        target: item?.target ?? "pull-request",
        itemId: item?.itemId ?? 0,
        repositoryName: entry?.repositoryName || null,
      }),
  });

  if (!item) {
    return (
      <div tabIndex={-1} className="px-3 py-3 text-xs text-muted-foreground outline-none">
        {entry
          ? "The agent can only be asked about a pull request or a work item."
          : "Select an item to ask the agent about it."}
      </div>
    );
  }

  const notes: AgentNote[] = (actions.notesQuery.data ?? [])
    .filter((note) => note.status !== "draft")
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const waiting = notes.find((note) => noteNeedsYou(note));
  const configured = !!settings?.agentCommand;
  const hasFolder =
    item.target === "pull-request"
      ? !!settings?.reviewResultFolderPath
      : !!settings?.workItemResultFolderPath;
  const unavailable = !configured
    ? "Set an agent command in Settings to ask the agent."
    : !hasFolder
      ? "Set a result folder in Settings so notes can be exchanged with the agent."
      : null;

  async function ask(content: string): Promise<void> {
    if (!item) return;
    if (waiting) {
      // The agent asked something: answer on the same note.
      await actions.reply.mutateAsync({ noteId: waiting.id, body: content });
    } else {
      await actions.create.mutateAsync({
        ...item,
        body: content,
        quote: entry?.snippet,
        kind: "question",
      });
    }
    await run.mutateAsync();
  }

  const error = actions.notesQuery.isError
    ? commandErrorMessage(actions.notesQuery.error)
    : run.isError
      ? commandErrorMessage(run.error)
      : null;
  const label = item.target === "pull-request" ? `!${item.itemId}` : `#${item.itemId}`;

  return (
    <div
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !(event.target instanceof HTMLTextAreaElement)) {
          event.preventDefault();
          onReturnToList();
        }
      }}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2 outline-none"
    >
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <Bot className="h-4 w-4" aria-hidden="true" />
        Agent · {label}
        {waiting ? (
          <span className="rounded border border-violet-300 px-1 text-[11px] font-semibold text-violet-700 dark:border-violet-900 dark:text-violet-300">
            Needs you
          </span>
        ) : null}
        {run.isPending ? (
          <span className="text-[11px] font-normal text-muted-foreground">Starting…</span>
        ) : null}
      </h2>

      <div className="-mx-2 mt-1">
        <PreviewBand>Thread</PreviewBand>
      </div>
      {actions.notesQuery.isLoading && configured ? <LoadingState /> : null}
      {error ? <ErrorState message={error} /> : null}
      {notes.length === 0 && !actions.notesQuery.isLoading ? (
        <p className="py-1 text-xs text-muted-foreground">
          {unavailable ??
            "No conversation yet. Ask below; the comment you are looking at is quoted for the agent."}
        </p>
      ) : (
        <div className="space-y-1.5 py-1">
          {notes.map((note) => (
            <div key={note.id} className="space-y-1">
              <Message author="user" when={note.createdAt} text={note.body} quote={note.quote} />
              {note.replies.map((reply, index) => (
                <Message
                  key={`${note.id}-${index}`}
                  author={reply.author}
                  when={reply.createdAt}
                  text={reply.body}
                />
              ))}
              {note.status === "done" && note.resolved ? (
                <p className="pl-1 text-[11px] text-muted-foreground">Done: {note.resolved}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {unavailable && notes.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">{unavailable}</p>
      ) : null}
      {readOnly ? (
        <p className="text-[11px] text-muted-foreground">
          Read-only validation mode: the agent is not started.
        </p>
      ) : (
        <div ref={composerRef} data-inbox-agent-composer="true" className="mt-1">
          <CommentComposer
            placeholder={waiting ? "Answer the agent…" : "Ask the agent…"}
            submitLabel={waiting ? "Answer" : "Ask"}
            busy={run.isPending || actions.create.isPending || actions.reply.isPending}
            onSubmit={ask}
          />
        </div>
      )}
    </div>
  );
}
