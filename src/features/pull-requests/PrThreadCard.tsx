import { useState } from "react";
import { type PrThread } from "@/lib/azdoCommands";
import { formatDate, formatRelativeDate } from "@/lib/utils";
import { MarkdownView } from "@/lib/markdown";

export function isThreadResolved(thread: PrThread): boolean {
  return thread.status != null && thread.status !== "active" && thread.status !== "pending";
}

/**
 * Shared thread card used by the Review tab and the inline diff view.
 * Owns its reply draft state; parents only handle the actual mutations.
 */
export function PrThreadCard({
  thread,
  busy,
  showFilePath = true,
  onReply,
  onToggleStatus,
}: {
  thread: PrThread;
  busy: boolean;
  showFilePath?: boolean;
  onReply: (content: string) => void;
  onToggleStatus: () => void;
}) {
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");
  const resolved = isThreadResolved(thread);

  function submitReply() {
    if (!replyText.trim()) return;
    onReply(replyText);
    setReplying(false);
    setReplyText("");
  }

  return (
    <div
      className={`rounded-md border px-2 py-1.5 ${
        resolved ? "border-border bg-gray-50/60" : "border-border bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {thread.status ? (
            <span
              className={`inline-flex shrink-0 items-center rounded border px-1 py-px text-[10px] font-medium ${
                resolved
                  ? "border-gray-200 bg-gray-100 text-gray-500"
                  : "border-blue-200 bg-blue-50 text-blue-700"
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
        {thread.status ? (
          <button
            type="button"
            disabled={busy}
            onClick={onToggleStatus}
            className="shrink-0 rounded border border-border bg-white px-1.5 py-px text-[10px] text-muted-foreground hover:bg-secondary disabled:opacity-50"
          >
            {resolved ? "Reactivate" : "Resolve"}
          </button>
        ) : null}
      </div>
      <div className="mt-1 space-y-1.5">
        {thread.comments
          .filter((comment) => !comment.isSystem)
          .map((comment) => (
            <div key={comment.id} className="text-xs">
              <span className="font-medium text-foreground">{comment.author ?? "Unknown"}</span>
              {comment.publishedDate ? (
                <span
                  className="ml-1 text-[10px] text-muted-foreground"
                  title={formatDate(comment.publishedDate)}
                >
                  {formatRelativeDate(comment.publishedDate)}
                </span>
              ) : null}
              <MarkdownView text={comment.content ?? ""} className="text-foreground" />
            </div>
          ))}
      </div>
      {replying ? (
        <div className="mt-1.5">
          <textarea
            autoFocus
            value={replyText}
            onChange={(event) => setReplyText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                submitReply();
              }
              if (event.key === "Escape") {
                event.stopPropagation();
                setReplying(false);
              }
            }}
            rows={2}
            placeholder="Reply… (Ctrl+Enter to post)"
            aria-label="Reply to thread"
            className="w-full resize-y rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-1 flex justify-end gap-1">
            <button
              type="button"
              onClick={() => setReplying(false)}
              className="rounded border border-border bg-white px-1.5 py-px text-[10px] hover:bg-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!replyText.trim() || busy}
              onClick={submitReply}
              className="rounded border border-border bg-white px-1.5 py-px text-[10px] hover:bg-secondary disabled:opacity-50"
            >
              Reply
            </button>
          </div>
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
