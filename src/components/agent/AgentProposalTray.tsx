import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AgentNote } from "@/lib/azdoCommands";
import { AgentProposal, type ProposalCodeContext } from "./AgentProposal";
import { pendingProposals } from "./agentProposals";

/**
 * The comments the agent proposes in the open conversation and that are not
 * posted yet, gathered above the input so they are reviewed in one place
 * instead of being searched for in the conversation. A posted one leaves the
 * tray and stays in the conversation as history. C posts the first.
 */
export function AgentProposalTray({
  note,
  onPost,
  busy,
  error,
  autoPost,
  codeContext,
}: {
  note: AgentNote;
  /** Posts the proposal at this reply index; null where nothing can be posted. */
  onPost: ((replyIndex: number) => void) | null;
  busy: boolean;
  error: string | null;
  autoPost: boolean;
  codeContext: ProposalCodeContext | null;
}) {
  const [open, setOpen] = useState(true);
  const pending = pendingProposals(note);
  if (!pending.length) return null;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="shrink-0 border-t border-border bg-violet-50/60 px-2 py-1 dark:bg-violet-950/20" data-agent-proposal-tray="true">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1 rounded text-left text-2xs font-semibold text-violet-800 outline-none focus-visible:ring-1 focus-visible:ring-ring dark:text-violet-200"
      >
        <Chevron className="h-3 w-3" aria-hidden="true" />
        Proposed comments to post: {pending.length}
        <span className="font-normal text-muted-foreground">· C posts the first</span>
      </button>
      {open ? (
        <div className="mt-1 max-h-64 space-y-2 overflow-y-auto pb-1">
          {pending.map(({ index, reply }) => (
            <AgentProposal
              key={index}
              reply={reply}
              onPost={onPost ? () => onPost(index) : null}
              busy={busy}
              autoPost={autoPost}
              error={error}
              codeContext={codeContext}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
