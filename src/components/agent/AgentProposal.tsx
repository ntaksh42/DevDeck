import { Check, Loader2, Send } from "lucide-react";
import type { NoteReply } from "@/lib/azdoCommands";
import { NoteMarkdown } from "@/components/agent-notes/NoteMarkdown";
import { CommentAvatar } from "@/features/pull-requests/PrThreadCard";
import { formatRelativeDate } from "@/lib/utils";
import { needsApproval, proposalSignature } from "./agentProposals";

/**
 * A comment the agent proposes to leave on the work item / pull request. It
 * shows the text with the signature DevDeck will append; posting is one key
 * (C on the conversation) or the button, or automatic when Settings allows it.
 */
export function AgentProposal({
  reply,
  onPost,
  busy,
  autoPost,
  error,
}: {
  reply: NoteReply;
  onPost: (() => void) | null;
  busy: boolean;
  autoPost: boolean;
  error: string | null;
}) {
  const signature = proposalSignature(reply.author);
  const posted = !!reply.postedAt;
  return (
    <div className="text-xs" data-agent-proposal={posted ? "posted" : "pending"}>
      <div className="flex min-w-0 items-center gap-1.5">
        <CommentAvatar name={reply.author} />
        <span className="truncate font-medium text-violet-700 dark:text-violet-300">@{reply.author}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelativeDate(reply.createdAt)}</span>
        <span
          className={`shrink-0 rounded border px-1.5 text-[11px] leading-4 ${
            posted
              ? "border-border bg-muted text-muted-foreground"
              : "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300"
          }`}
        >
          {posted ? "Posted" : "Proposed comment"}
        </span>
      </div>
      <div className="space-y-1 pl-[26px]">
        <div className="rounded border border-dashed border-border px-1.5 py-1">
          <NoteMarkdown text={reply.body} className="text-[13px] leading-5 text-foreground" />
          {signature ? <p className="mt-1 text-[11px] text-muted-foreground">{signature}</p> : null}
        </div>
        {posted ? (
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Check className="h-3 w-3" aria-hidden="true" />
            Posted {formatRelativeDate(reply.postedAt ?? "")}
            {reply.postedRef ? ` · ${reply.postedRef}` : ""}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {onPost ? (
              <button
                type="button"
                tabIndex={-1}
                onClick={onPost}
                disabled={busy}
                title="Post this comment, signed (C)"
                className="inline-flex items-center gap-1 rounded border border-violet-400 px-1.5 py-0.5 text-violet-800 hover:bg-violet-100 disabled:opacity-60 dark:text-violet-200 dark:hover:bg-violet-950"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Send className="h-3 w-3" aria-hidden="true" />}
                Post (C)
              </button>
            ) : null}
            {autoPost && needsApproval(reply) ? (
              <span className="text-muted-foreground">Has a link or @mention, so it needs your approval.</span>
            ) : null}
            {error ? <span role="alert" className="text-destructive">{error}</span> : null}
          </div>
        )}
      </div>
    </div>
  );
}
