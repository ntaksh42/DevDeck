import { forwardRef, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { AgentMessage } from "./AgentMessage";
import { AgentProposal, type ProposalCodeContext } from "./AgentProposal";
import { AgentStatus, conversationMeta } from "./AgentConversationList";
import { pendingProposals } from "./agentProposals";
import type { Conversation } from "./useAgentPanelData";

/**
 * One conversation over the panel's whole height, like a chat: a header with
 * the way back to the list, then the messages, newest at the bottom. The
 * message area is the keyboard target (Esc goes back, R replies); comments the
 * agent proposes are only pointed at here, as they wait in the tray below.
 */
export const AgentChat = forwardRef<
  HTMLDivElement,
  {
    conversation: Conversation;
    onBack: () => void;
    /** What can be done to the conversation; keys in the panel mirror them. */
    actions: { label: string; keys: string; run: () => void }[];
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
    codeContext: ProposalCodeContext | null;
  }
>(function AgentChat({ conversation, onBack, actions, onKeyDown, codeContext }, ref) {
  const { note } = conversation;
  const pending = new Set(pendingProposals(note).map((p) => p.index));
  const bottom = useRef<HTMLDivElement>(null);
  // Open at the newest message, and follow new replies down.
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [conversation.key, note.replies.length]);

  return (
    <>
      <div className="shrink-0 border-b border-border px-2 py-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            tabIndex={-1}
            onClick={onBack}
            title="Back to the conversations (Esc)"
            aria-label="Back to the conversations"
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={note.body}>
            {note.body.split("\n")[0]}
          </span>
          <AgentStatus note={note} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 pl-6 text-2xs text-muted-foreground">
          <span className="min-w-0 truncate">{conversationMeta(note)}</span>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              tabIndex={-1}
              onClick={action.run}
              title={`${action.label} (${action.keys})`}
              className="underline-offset-2 hover:text-foreground hover:underline"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={ref}
        tabIndex={0}
        aria-label={`Conversation: ${note.body.split("\n")[0]}`}
        data-agent-chat={note.id}
        data-pane-focus-target="true"
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-2 py-2 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <AgentMessage author="user" when={note.createdAt} text={note.body} quote={note.quote} />
        {note.replies.map((reply, index) =>
          reply.kind === "post" ? (
            pending.has(index) ? (
              <p key={index} className="text-2xs text-violet-700 dark:text-violet-300">
                ↳ {reply.author} proposed a comment — waiting below
              </p>
            ) : (
              <AgentProposal key={index} reply={reply} onPost={null} busy={false} autoPost={false} error={null} codeContext={codeContext} />
            )
          ) : (
            <AgentMessage key={index} author={reply.author} when={reply.createdAt} text={reply.body} />
          ),
        )}
        {note.status === "done" && note.resolved ? <p className="text-2xs text-muted-foreground">✓ {note.resolved}</p> : null}
        <div ref={bottom} />
      </div>
    </>
  );
});
