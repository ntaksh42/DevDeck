import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type {
  MentionCandidate,
  PrThread,
  WorkItemComment,
  WorkItemPreview,
} from "@/lib/azdoCommands";
import type { SelectedMention } from "@/features/work-items/workItemMentions";
import { focusPrimaryPreview, formatRelativeDate } from "@/lib/utils";
import { CommentComposer } from "@/features/pull-requests/CommentComposer";
import { PrThreadCard } from "@/features/pull-requests/PrThreadCard";
import { RichHtmlFrame } from "@/features/work-items/RichHtmlFrame";
import { commentRichHtml } from "@/features/work-items/workItemHtml";
import type { InboxEntry } from "./inboxPresentation";

/** Text to start the reply box with; a new `key` remounts the composer with it. */
export type ReplySeed = { text: string; key: number };

export const ACTION_BUTTON =
  "inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-0.5 text-xs font-medium hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export function Kbd({ children }: { children: string }) {
  return <kbd className="rounded border border-border bg-muted px-1 text-[10px] font-mono">{children}</kbd>;
}

export function ThreadPanel({
  item,
  thread,
  busy,
  readOnly,
  mentionSearch,
  resolveImageSource,
  onReply,
  onReplyAndResolve,
  onToggleStatus,
  beforeComposer,
  draft,
}: {
  item: InboxEntry;
  thread: PrThread | null;
  busy: boolean;
  readOnly: boolean;
  mentionSearch: (query: string) => Promise<MentionCandidate[]>;
  resolveImageSource: (url: string) => Promise<string | null>;
  onReply: (content: string) => Promise<void>;
  /** Ctrl+Shift+Enter in the reply box: reply, then resolve the thread. */
  onReplyAndResolve: (content: string) => Promise<void>;
  onToggleStatus: () => void;
  /** Shown between the thread and the reply box (the code under the comment). */
  beforeComposer?: ReactNode;
  draft?: ReplySeed;
}) {
  if (!thread) {
    return (
      <p className="py-2 text-xs text-muted-foreground">
        This thread is no longer on the pull request (it may have been deleted). Mark the item Done
        to clear it.
      </p>
    );
  }
  return (
    <>
      <PrThreadCard
        thread={thread}
        busy={busy || readOnly}
        showFilePath
        showReply={false}
        mentionSearch={mentionSearch}
        resolveImageSource={resolveImageSource}
        baseUrl={item.webUrl}
        onReply={onReply}
        onToggleStatus={onToggleStatus}
      />
      {beforeComposer}
      {readOnly ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Read-only validation mode: replies and status changes are disabled.
        </p>
      ) : (
        <div data-inbox-composer="true" className="sticky bottom-0 z-10 mt-1 border-t border-border bg-card pt-1">
          <CommentComposer
            key={draft?.key ?? 0}
            initialValue={draft?.text ?? ""}
            autoFocus={!!draft}
            placeholder="Reply…"
            submitLabel="Reply"
            busy={busy}
            mentionSearch={mentionSearch}
            onSubmit={onReply}
            onAltSubmit={thread.isResolved ? undefined : onReplyAndResolve}
            altSubmitHint={thread.isResolved ? undefined : "Ctrl+Shift+Enter to post & resolve"}
            onCancel={focusPrimaryPreview}
          />
        </div>
      )}
    </>
  );
}

/**
 * Work item comments have no reply threads, so a reply is a new comment that
 * quotes the comment and @mentions its author (a real, notifying mention when
 * the author's id is known).
 */
export function workItemReplyDraft(comment: WorkItemComment): {
  text: string;
  mentions: SelectedMention[];
} {
  const plain =
    new DOMParser().parseFromString(comment.text ?? "", "text/html").body.textContent ?? "";
  const line = plain.replace(/\s+/g, " ").trim();
  const quote = line.length > 120 ? `${line.slice(0, 119)}…` : line;
  const name = comment.createdBy;
  return {
    text: `${quote ? `> ${quote}\n\n` : ""}${name ? `@${name} ` : ""}`,
    mentions:
      name && comment.createdById
        ? [{ id: comment.createdById, displayName: name, uniqueName: comment.createdByUniqueName ?? null }]
        : [],
  };
}

/** The work item behind an assignment or a mention, with its latest comments. */
export function WorkItemPanel({
  item,
  workItem,
  busy,
  readOnly,
  mentionSearch,
  resolveImageSource,
  onComment,
  draft,
}: {
  item: InboxEntry;
  workItem: WorkItemPreview | null;
  busy: boolean;
  readOnly: boolean;
  mentionSearch: (query: string) => Promise<MentionCandidate[]>;
  resolveImageSource: (url: string) => Promise<string | null>;
  onComment: (markdown: string) => Promise<void>;
  draft?: ReplySeed;
}) {
  const [showAll, setShowAll] = useState(false);
  // The comment being answered; `key` remounts the composer with its draft.
  const [replyTo, setReplyTo] = useState<{ comment: WorkItemComment; key: number } | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!replyTo) return;
    const textarea = composerRef.current?.querySelector("textarea");
    textarea?.focus();
    textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [replyTo]);
  // A reply draft from Claude's notes replaces any reply in progress.
  useEffect(() => {
    if (draft) setReplyTo(null);
  }, [draft]);

  if (!workItem) {
    return (
      <p className="py-2 text-xs text-muted-foreground">
        {item.snippet ?? "The work item could not be loaded."}
      </p>
    );
  }
  // Newest first from the service; show the mention and what followed it.
  const mentionIndex = workItem.comments.findIndex((comment) => comment.id === item.commentId);
  const shown = Math.max(3, mentionIndex + 1);
  const latest = workItem.comments.slice(0, showAll ? undefined : shown);
  const mentionDisplayNames = new Map<string, string>();
  return (
    <div className="space-y-1.5 py-1">
      <p className="text-xs text-muted-foreground">
        {[workItem.workItemType, workItem.state, workItem.assignedTo ?? "Unassigned", workItem.priority && `P${workItem.priority}`]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {latest.length === 0 ? (
        <p className="text-xs text-muted-foreground">No comments yet.</p>
      ) : (
        <div className="divide-y divide-border rounded border border-border">
          {latest.map((comment) => (
            <div
              key={comment.id}
              className={`px-2 py-1 ${
                comment.id === item.commentId ? "border-l-[3px] border-l-amber-400 bg-amber-50/40 dark:bg-amber-950/20" : ""
              }`}
            >
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{comment.createdBy ?? "Unknown"}</span>
                {comment.createdDate ? <span>{formatRelativeDate(comment.createdDate)}</span> : null}
                {readOnly ? null : (
                  <button
                    type="button"
                    data-inbox-mention-reply={comment.id === item.commentId ? "true" : undefined}
                    onClick={() => setReplyTo((current) => ({ comment, key: (current?.key ?? 0) + 1 }))}
                    className="ml-auto rounded px-1 font-medium text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    Reply
                  </button>
                )}
              </div>
              <RichHtmlFrame
                baseUrl={workItem.webUrl}
                density="compact"
                framed={false}
                html={commentRichHtml(comment.renderedText, comment.text, mentionDisplayNames)}
                lazy
                title={`Comment by ${comment.createdBy ?? "Unknown"}`}
                resolveImageSource={resolveImageSource}
                minHeight={22}
              />
            </div>
          ))}
        </div>
      )}
      {workItem.comments.length > shown && !showAll ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
        >
          Show {workItem.comments.length - shown} older comments
        </button>
      ) : null}
      {readOnly ? (
        <p className="text-[11px] text-muted-foreground">
          Read-only validation mode: commenting is disabled.
        </p>
      ) : (
        // Pinned to the bottom of the preview so it stays in reach of long discussions.
        <div ref={composerRef} data-inbox-composer="true" className="sticky bottom-0 z-10 bg-card pt-1">
          {replyTo ? (
            <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>Replying to {replyTo.comment.createdBy ?? "Unknown"}</span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="rounded px-1 hover:text-foreground hover:underline focus:outline-none focus:ring-2 focus:ring-ring"
              >
                Cancel
              </button>
            </div>
          ) : null}
          <CommentComposer
            key={`${replyTo?.key ?? 0}:${draft?.key ?? 0}`}
            autoFocus={!replyTo && !!draft}
            placeholder={replyTo ? "Reply…" : "Comment…"}
            submitLabel={replyTo ? "Reply" : "Comment"}
            initialValue={replyTo ? workItemReplyDraft(replyTo.comment).text : (draft?.text ?? "")}
            initialMentions={replyTo ? workItemReplyDraft(replyTo.comment).mentions : undefined}
            busy={busy}
            mentionSearch={mentionSearch}
            onSubmit={onComment}
            onSubmitted={() => setReplyTo(null)}
          />
        </div>
      )}
    </div>
  );
}
