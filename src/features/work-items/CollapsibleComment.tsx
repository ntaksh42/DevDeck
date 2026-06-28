import { useEffect, useState } from "react";
import { Check, Loader2, Pencil, SmilePlus, Trash2, X } from "lucide-react";
import { formatRelativeDate } from "@/lib/utils";
import { commentAuthorInitials } from "./workItemHtml";
import { RichHtmlFrame } from "./RichHtmlFrame";

// Azure DevOps comment reaction types, in display order, with their emoji.
const COMMENT_REACTIONS: { type: string; emoji: string; label: string }[] = [
  { type: "like", emoji: "👍", label: "Like" },
  { type: "heart", emoji: "❤️", label: "Heart" },
  { type: "hooray", emoji: "🎉", label: "Hooray" },
  { type: "smile", emoji: "😄", label: "Smile" },
  { type: "confused", emoji: "😕", label: "Confused" },
  { type: "dislike", emoji: "👎", label: "Dislike" },
];

type CommentReaction = { reactionType: string; count: number; isMine: boolean };

export function CollapsibleComment({
  baseUrl,
  commentHtml,
  commentText,
  createdBy,
  createdDate,
  deleting,
  deletePending,
  editing,
  editPending,
  id,
  onDelete,
  onEdit,
  onImageOpen,
  reactions,
  onToggleReaction,
  reactionPending,
  resolveImageSource,
}: {
  baseUrl?: string | null;
  commentHtml: string;
  commentText: string | null;
  createdBy: string | null;
  createdDate: string | null;
  deleting: boolean;
  deletePending: boolean;
  editing: boolean;
  editPending: boolean;
  id: number;
  onDelete: (commentId: number) => void;
  onEdit: (commentId: number, markdown: string) => void;
  onImageOpen: (src: string) => void;
  reactions: CommentReaction[];
  onToggleReaction?: (commentId: number, reactionType: string, engaged: boolean) => void;
  reactionPending: boolean;
  resolveImageSource: (url: string) => Promise<string | null>;
}) {
  // Char count is the pre-render guess (avoids a flicker before the iframe
  // reports its height); the measured height refines it so a short comment with
  // heavy markup isn't collapsed and a tall one always gets its toggle.
  const [expanded, setExpanded] = useState(commentHtml.length < 700);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState(commentText ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  // Headroom over the max-h-32 (128px) clamp so a comment barely past it doesn't
  // sprout a toggle for a few pixels.
  const collapsible =
    contentHeight == null ? commentHtml.length >= 700 : contentHeight > 150;
  const reactionByType = new Map(reactions.map((reaction) => [reaction.reactionType, reaction]));

  // Once measured short, drop any pre-render collapse so the toggle disappears.
  useEffect(() => {
    if (contentHeight != null && contentHeight <= 150) setExpanded(true);
  }, [contentHeight]);

  function startEdit() {
    setDraft(commentText ?? "");
    setEditMode(true);
  }

  function cancelEdit() {
    setEditMode(false);
    setDraft(commentText ?? "");
  }

  function saveEdit() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === (commentText ?? "").trim()) {
      cancelEdit();
      return;
    }
    onEdit(id, trimmed);
  }

  // Leave edit mode once the in-flight save for this comment resolves.
  useEffect(() => {
    if (!editing && !editPending) setEditMode(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  return (
    <article className="group min-w-0 overflow-hidden rounded-md border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex min-w-0 items-center gap-1.5 border-b border-border bg-muted px-1.5 py-0.5">
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-semibold text-blue-700 dark:bg-blue-500/25 dark:text-blue-200">
          {commentAuthorInitials(createdBy)}
        </span>
        <span className="min-w-0 truncate font-semibold">
          {createdBy ?? "Unknown"}
        </span>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">commented</span>
        {createdDate ? (
          <span
            className="shrink-0 text-[11px] text-muted-foreground"
            title={new Date(createdDate).toLocaleString()}
          >
            {formatRelativeDate(createdDate)}
          </span>
        ) : null}
        {!editMode ? (
          <button
            type="button"
            aria-label={`Edit comment ${id}`}
            className="ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-transparent text-muted-foreground opacity-0 transition-opacity hover:border-border hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed"
            disabled={deletePending || editPending}
            title="Edit comment"
            onClick={startEdit}
          >
            <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`Delete comment ${id}`}
          className={`${editMode ? "ml-auto" : ""} inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-transparent text-muted-foreground transition-opacity hover:border-border hover:bg-accent hover:text-destructive disabled:cursor-not-allowed ${deleting ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
          disabled={deletePending || editPending}
          title="Delete comment"
          onClick={() => onDelete(id)}
        >
          {deleting ? (
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <div className="px-1.5 py-1">
        {editMode ? (
          <div className="grid gap-1">
            <textarea
              aria-label={`Edit comment ${id}`}
              value={draft}
              autoFocus
              disabled={editPending}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelEdit();
                } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  saveEdit();
                }
              }}
              rows={Math.min(10, Math.max(3, draft.split("\n").length + 1))}
              className="w-full resize-y rounded border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={saveEdit}
                disabled={editPending || !draft.trim()}
                className="inline-flex items-center gap-1 rounded border border-border bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {editPending ? (
                  <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
                ) : (
                  <Check aria-hidden="true" className="h-3 w-3" />
                )}
                Save
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={editPending}
                className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X aria-hidden="true" className="h-3 w-3" />
                Cancel
              </button>
              <span className="text-[10px] text-muted-foreground/70">Ctrl+Enter to save · Esc to cancel</span>
            </div>
          </div>
        ) : (
          <>
            <div className={expanded || !collapsible ? "" : "max-h-32 overflow-hidden"}>
              <RichHtmlFrame
                baseUrl={baseUrl}
                density="compact"
                framed={false}
                html={commentHtml}
                lazy
                title={`Comment by ${createdBy ?? "Unknown"}`}
                resolveImageSource={resolveImageSource}
                onImageOpen={onImageOpen}
                onHeight={setContentHeight}
                minHeight={22}
              />
            </div>
            {collapsible ? (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="mt-1 rounded border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                {expanded ? "Collapse" : "Expand"}
              </button>
            ) : null}
            {onToggleReaction ? (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {COMMENT_REACTIONS.filter(
                  (reaction) => (reactionByType.get(reaction.type)?.count ?? 0) > 0,
                ).map((reaction) => {
                  const state = reactionByType.get(reaction.type);
                  const mine = state?.isMine ?? false;
                  return (
                    <button
                      key={reaction.type}
                      type="button"
                      disabled={reactionPending}
                      onClick={() => onToggleReaction(id, reaction.type, !mine)}
                      aria-pressed={mine}
                      title={`${reaction.label}${mine ? " (you reacted)" : ""}`}
                      className={`inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[11px] tabular-nums disabled:cursor-not-allowed disabled:opacity-60 ${
                        mine
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-card text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      <span aria-hidden="true">{reaction.emoji}</span>
                      {state?.count ?? 0}
                    </button>
                  );
                })}
                <div className="relative">
                  <button
                    type="button"
                    disabled={reactionPending}
                    aria-label="Add reaction"
                    aria-expanded={pickerOpen}
                    title="Add reaction"
                    onClick={() => setPickerOpen((open) => !open)}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <SmilePlus className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  {pickerOpen ? (
                    <div
                      role="menu"
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setPickerOpen(false);
                        }
                      }}
                      className="absolute left-0 top-full z-30 mt-1 flex gap-0.5 rounded-md border border-border bg-popover p-1 shadow-lg"
                    >
                      {COMMENT_REACTIONS.map((reaction) => {
                        const mine = reactionByType.get(reaction.type)?.isMine ?? false;
                        return (
                          <button
                            key={reaction.type}
                            type="button"
                            role="menuitem"
                            title={reaction.label}
                            onClick={() => {
                              onToggleReaction(id, reaction.type, !mine);
                              setPickerOpen(false);
                            }}
                            className={`inline-flex h-7 w-7 items-center justify-center rounded text-base hover:bg-accent ${
                              mine ? "bg-primary/10" : ""
                            }`}
                          >
                            <span aria-hidden="true">{reaction.emoji}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </article>
  );
}
