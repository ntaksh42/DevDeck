import { NoteMarkdown } from "@/components/agent-notes/NoteMarkdown";
import { CommentAvatar } from "@/features/pull-requests/PrThreadCard";
import { formatRelativeDate } from "@/lib/utils";

/**
 * One message of a conversation, laid out like a chat: the user's own on the
 * right in a bubble, the agent's on the left at full width (so a narrow panel
 * keeps its line length), its name in violet.
 */
export function AgentMessage({
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
  if (author === "user") {
    return (
      <div className="flex justify-end" data-agent-message="user">
        <div
          className="max-w-[85%] rounded-lg rounded-br-sm border border-primary/25 bg-primary/10 px-2 py-1"
          title={formatRelativeDate(when)}
        >
          {quote ? (
            <p className="line-clamp-2 break-words border-l-2 border-warning pl-1.5 text-2xs text-muted-foreground" title={quote}>
              {quote}
            </p>
          ) : null}
          <NoteMarkdown text={text} className="text-[13px] leading-5 text-foreground" />
        </div>
      </div>
    );
  }
  return (
    <div className="text-xs" data-agent-message="agent">
      <div className="flex min-w-0 items-center gap-1.5">
        <CommentAvatar name={author} />
        <span className="truncate font-medium text-violet-700 dark:text-violet-300">{author}</span>
        <span className="shrink-0 text-2xs text-muted-foreground">{formatRelativeDate(when)}</span>
      </div>
      <NoteMarkdown text={text} className="pt-0.5 text-[13px] leading-5 text-foreground" />
    </div>
  );
}
