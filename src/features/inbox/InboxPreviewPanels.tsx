import { useState } from "react";
import type { MentionCandidate, PrThread, PullRequestReview, WorkItemPreview } from "@/lib/azdoCommands";
import { formatRelativeDate } from "@/lib/utils";
import { CommentComposer } from "@/features/pull-requests/CommentComposer";
import { PrThreadCard } from "@/features/pull-requests/PrThreadCard";
import { RichHtmlFrame } from "@/features/work-items/RichHtmlFrame";
import { commentRichHtml } from "@/features/work-items/workItemHtml";
import type { InboxEntry } from "./inboxPresentation";
import type { VoteValue } from "./useInboxDetail";

export const ACTION_BUTTON =
  "inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-0.5 text-xs font-medium hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export function Kbd({ children }: { children: string }) {
  return <kbd className="rounded border border-border bg-muted px-1 text-[10px] font-mono">{children}</kbd>;
}

const VOTES: { value: VoteValue; label: string; key: string; tone: string }[] = [
  { value: 10, label: "Approve", key: "A", tone: "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300" },
  { value: 5, label: "Approve with suggestions", key: "S", tone: "" },
  { value: -5, label: "Wait for author", key: "W", tone: "" },
  { value: -10, label: "Reject", key: "X", tone: "border-red-300 text-red-700 dark:border-red-900 dark:text-red-300" },
  { value: 0, label: "No vote", key: "0", tone: "" },
];

/** The thread of a mention / reply, answered in place. */
export function ThreadPanel({
  item,
  thread,
  busy,
  readOnly,
  mentionSearch,
  resolveImageSource,
  onReply,
  onToggleStatus,
}: {
  item: InboxEntry;
  thread: PrThread | null;
  busy: boolean;
  readOnly: boolean;
  mentionSearch: (query: string) => Promise<MentionCandidate[]>;
  resolveImageSource: (url: string) => Promise<string | null>;
  onReply: (content: string) => Promise<void>;
  onToggleStatus: () => void;
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
        mentionSearch={mentionSearch}
        resolveImageSource={resolveImageSource}
        baseUrl={item.webUrl}
        onReply={onReply}
        onToggleStatus={onToggleStatus}
      />
      {readOnly ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Read-only validation mode: replies and status changes are disabled.
        </p>
      ) : null}
    </>
  );
}

/** A pull request waiting for the user's vote. */
export function VotePanel({
  review,
  busy,
  readOnly,
  onVote,
}: {
  review: PullRequestReview | null;
  busy: boolean;
  readOnly: boolean;
  onVote: (value: VoteValue) => void;
}) {
  const mine = review?.reviewers.find((reviewer) => reviewer.isMe);
  return (
    <div className="space-y-1.5 py-1">
      {review?.description ? (
        <p className="line-clamp-4 whitespace-pre-line text-xs text-muted-foreground">
          {review.description}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {VOTES.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={busy || readOnly}
            onClick={() => onVote(option.value)}
            className={`${ACTION_BUTTON} ${option.tone} ${
              mine?.vote === option.value ? "ring-1 ring-primary" : ""
            }`}
          >
            {option.label} <Kbd>{option.key}</Kbd>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {readOnly
          ? "Read-only validation mode: voting is disabled."
          : "Voting finishes this item. Open it in DevDeck (Shift+Enter) to review the changes first."}
      </p>
    </div>
  );
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
}: {
  item: InboxEntry;
  workItem: WorkItemPreview | null;
  busy: boolean;
  readOnly: boolean;
  mentionSearch: (query: string) => Promise<MentionCandidate[]>;
  resolveImageSource: (url: string) => Promise<string | null>;
  onComment: (markdown: string) => Promise<void>;
}) {
  const [showAll, setShowAll] = useState(false);
  if (!workItem) {
    return (
      <p className="py-2 text-xs text-muted-foreground">
        {item.snippet ?? "The work item could not be loaded."}
      </p>
    );
  }
  // Newest first from the service; show the mention and what followed it.
  const latest = workItem.comments.slice(0, showAll ? undefined : 3);
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
      {workItem.comments.length > 3 && !showAll ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
        >
          Show {workItem.comments.length - 3} older comments
        </button>
      ) : null}
      {readOnly ? (
        <p className="text-[11px] text-muted-foreground">
          Read-only validation mode: commenting is disabled.
        </p>
      ) : (
        <div data-inbox-composer="true">
          <CommentComposer
            placeholder="Comment…"
            submitLabel="Comment"
            busy={busy}
            mentionSearch={mentionSearch}
            onSubmit={onComment}
          />
        </div>
      )}
    </div>
  );
}

/** A pipeline approval waiting for the user. */
export function ApprovalPanel({
  item,
  busy,
  readOnly,
  onDecide,
}: {
  item: InboxEntry;
  busy: boolean;
  readOnly: boolean;
  onDecide: (status: "approved" | "rejected", comment?: string) => void;
}) {
  const [comment, setComment] = useState("");
  return (
    <div className="space-y-1.5 py-1">
      <p className="whitespace-pre-line text-xs">{item.snippet}</p>
      <label className="block text-[11px] text-muted-foreground">
        Comment (optional)
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={2}
          className="mt-0.5 w-full rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={busy || readOnly}
          onClick={() => onDecide("approved", comment)}
          className={`${ACTION_BUTTON} border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300`}
        >
          Approve <Kbd>A</Kbd>
        </button>
        <button
          type="button"
          disabled={busy || readOnly}
          onClick={() => onDecide("rejected", comment)}
          className={`${ACTION_BUTTON} border-red-300 text-red-700 dark:border-red-900 dark:text-red-300`}
        >
          Reject <Kbd>X</Kbd>
        </button>
      </div>
      {readOnly ? (
        <p className="text-[11px] text-muted-foreground">
          Read-only validation mode: approvals are disabled.
        </p>
      ) : null}
    </div>
  );
}
