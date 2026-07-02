import { useState } from "react";
import { type MentionCandidate, type PrThread } from "@/lib/azdoCommands";
import { focusPrimaryPreview, formatDate, formatRelativeDate } from "@/lib/utils";
import { MarkdownView } from "@/lib/markdown";
import { CommentComposer } from "./CommentComposer";

/**
 * Shared thread card used by the Review tab and the inline diff view.
 * Replies go through CommentComposer (Write/Preview + mentions), which keeps
 * the draft when a post fails.
 */
export function PrThreadCard({
  thread,
  busy,
  showFilePath = true,
  onReply,
  onToggleStatus,
  onEditComment,
  onDeleteComment,
  mentionSearch,
  resolveImageSource,
  baseUrl,
}: {
  thread: PrThread;
  busy: boolean;
  showFilePath?: boolean;
  onReply: (content: string) => Promise<void>;
  onToggleStatus: () => void;
  onEditComment?: (commentId: number, content: string) => Promise<void>;
  onDeleteComment?: (commentId: number) => Promise<void>;
  mentionSearch?: (query: string) => Promise<MentionCandidate[]>;
  resolveImageSource?: (url: string) => Promise<string | null>;
  baseUrl?: string | null;
}) {
  const [replying, setReplying] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const resolved = thread.isResolved;

  return (
    <div
      className={`rounded-md border px-2 py-1.5 ${
        resolved ? "border-border bg-muted/60" : "border-border bg-card"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {thread.status ? (
            <span
              className={`inline-flex shrink-0 items-center rounded border px-1 py-px text-[10px] font-medium ${
                resolved
                  ? "border-border bg-muted text-muted-foreground"
                  : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300"
              }`}
            >
              {resolved ? "Resolved" : "Active"}
            </span>
          ) : null}
          {showFilePath && thread.filePath ? (
            <span
              className="truncate font-mono text-[10px] text-muted-foreground"
              title={`${thread.filePath}${thread.rightLine ? `:${thread.rightLine}` : ""}`}
            >
              {thread.filePath}
              {thread.rightLine ? `:${thread.rightLine}` : ""}
            </span>
          ) : null}
        </div>
        {/* Threads without a status are still user discussions; default them to
            active so the Resolve toggle stays available (issue #434). */}
        <button
          type="button"
          disabled={busy}
          onClick={onToggleStatus}
          className="shrink-0 rounded border border-border bg-card px-1.5 py-px text-[10px] text-muted-foreground hover:bg-secondary disabled:opacity-50"
        >
          {resolved ? "Reactivate" : "Resolve"}
        </button>
      </div>
      <div className="mt-1 space-y-1.5">
        {thread.comments
          .filter((comment) => !comment.isSystem)
          .map((comment) => (
            <div key={comment.id} className="group/comment text-xs">
              <div className="flex items-center gap-1">
                <span className="font-medium text-foreground">{comment.author ?? "Unknown"}</span>
                {comment.publishedDate ? (
                  <span
                    className="text-[10px] text-muted-foreground"
                    title={formatDate(comment.publishedDate)}
                  >
                    {formatRelativeDate(comment.publishedDate)}
                  </span>
                ) : null}
                {comment.isMine && editingId !== comment.id && (onEditComment || onDeleteComment) ? (
                  <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover/comment:opacity-100">
                    {onEditComment ? (
                      <button
                        type="button"
                        onClick={() => setEditingId(comment.id)}
                        className="rounded px-1 py-px text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        Edit
                      </button>
                    ) : null}
                    {onDeleteComment ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm("Delete this comment?")) {
                            void onDeleteComment(comment.id);
                          }
                        }}
                        className="rounded px-1 py-px text-[10px] text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-50"
                      >
                        Delete
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </div>
              {editingId === comment.id && onEditComment ? (
                <div className="mt-1">
                  <CommentComposer
                    placeholder="Edit comment… (Ctrl+Enter to save)"
                    submitLabel="Save"
                    initialValue={comment.content ?? ""}
                    autoFocus
                    busy={busy}
                    mentionSearch={mentionSearch}
                    onSubmit={(content) => onEditComment(comment.id, content)}
                    onCancel={() => {
                      setEditingId(null);
                      focusPrimaryPreview();
                    }}
                    onSubmitted={() => {
                      setEditingId(null);
                      focusPrimaryPreview();
                    }}
                  />
                </div>
              ) : (
                <MarkdownView
                  text={comment.content ?? ""}
                  className="text-foreground"
                  resolveImageSource={resolveImageSource}
                  baseUrl={baseUrl}
                />
              )}
            </div>
          ))}
      </div>
      {replying ? (
        <div className="mt-1.5">
          <CommentComposer
            placeholder="Reply… (Ctrl+Enter to post)"
            submitLabel="Reply"
            autoFocus
            busy={busy}
            mentionSearch={mentionSearch}
            onSubmit={onReply}
            onCancel={() => {
              setReplying(false);
              focusPrimaryPreview();
            }}
            onSubmitted={() => {
              setReplying(false);
              focusPrimaryPreview();
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setReplying(true)}
          className="mt-1 rounded px-1 py-px text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          Reply
        </button>
      )}
    </div>
  );
}
