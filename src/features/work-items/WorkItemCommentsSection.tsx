import { useEffect, useState } from "react";
import type { MentionCandidate, Organization, WorkItemPreview } from "@/lib/azdoCommands";
import { commentRichHtml } from "./workItemHtml";
import { PreviewSection } from "./PreviewSection";
import { CollapsibleComment } from "./CollapsibleComment";
import { VISIBLE_COMMENT_LIMIT } from "./workItemPreviewHelpers";

// The work item's Azure DevOps comments. Rendered inline under the description,
// or in the preview's side column when the panel is wide enough.

export type WorkItemCommentsProps = {
  preview: WorkItemPreview;
  deleteCommentError: string | null;
  editCommentError: string | null;
  deletingCommentId: number | null;
  editingCommentId: number | null;
  editPending: boolean;
  deletePending: boolean;
  mentionDisplayNames: ReadonlyMap<string, string>;
  recentMentionOptions: MentionCandidate[];
  mentionPriorityNames: string[];
  selfOrg: Organization | undefined;
  onMentionApplied: (candidate: MentionCandidate) => void;
  onDeleteComment: (commentId: number) => void;
  onEditComment: (commentId: number, markdown: string) => void;
  onToggleCommentReaction?: (commentId: number, reactionType: string, engaged: boolean) => void;
  reactionPendingCommentId?: number | null;
  resolveImageSource: (url: string) => Promise<string | null>;
  onImageOpen: (src: string) => void;
};

export function WorkItemCommentsSection({
  preview,
  deleteCommentError,
  editCommentError,
  deletingCommentId,
  editingCommentId,
  editPending,
  deletePending,
  mentionDisplayNames,
  recentMentionOptions,
  mentionPriorityNames,
  selfOrg,
  onMentionApplied,
  onDeleteComment,
  onEditComment,
  onToggleCommentReaction,
  reactionPendingCommentId,
  resolveImageSource,
  onImageOpen,
  className = "",
}: WorkItemCommentsProps & { className?: string }) {
  const [showAllComments, setShowAllComments] = useState(false);

  useEffect(() => {
    setShowAllComments(false);
  }, [preview.id]);

  const visibleComments = showAllComments
    ? preview.comments
    : preview.comments.slice(0, VISIBLE_COMMENT_LIMIT);
  const hiddenCommentCount = preview.comments.length - visibleComments.length;

  return preview.comments.length > 0 ? (
    <PreviewSection
      accentColor="border-l-slate-400 dark:border-l-slate-500"
      className={className}
      collapseId="comments"
      title={`Comments (${preview.comments.length})`}
    >
      {deleteCommentError ? (
        <p className="mb-1 text-[11px] leading-4 text-destructive">
          {deleteCommentError}
        </p>
      ) : null}
      {editCommentError ? (
        <p className="mb-1 text-[11px] leading-4 text-destructive">
          {editCommentError}
        </p>
      ) : null}
      <div className="divide-y divide-border">
        {visibleComments.map((comment) => {
          const deleting = deletingCommentId === comment.id;
          const editing = editingCommentId === comment.id;
          return (
            <CollapsibleComment
              baseUrl={preview.webUrl}
              commentHtml={commentRichHtml(
                comment.renderedText,
                comment.text,
                mentionDisplayNames,
              )}
              commentText={comment.text}
              createdBy={comment.createdBy}
              createdDate={comment.createdDate}
              deleting={deleting}
              deletePending={deletePending}
              editing={editing}
              editPending={editPending}
              id={comment.id}
              key={comment.id}
              mentionScope={{
                organizationId: preview.organizationId,
                projectId: preview.projectId,
                id: preview.id,
              }}
              recentMentionOptions={recentMentionOptions}
              mentionPriorityNames={mentionPriorityNames}
              selfOrg={selfOrg}
              onMentionApplied={onMentionApplied}
              onDelete={onDeleteComment}
              onEdit={onEditComment}
              onImageOpen={onImageOpen}
              reactions={comment.reactions ?? []}
              onToggleReaction={onToggleCommentReaction}
              reactionPending={reactionPendingCommentId === comment.id}
              resolveImageSource={resolveImageSource}
            />
          );
        })}
        {hiddenCommentCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowAllComments(true)}
            className="w-full rounded border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            Show {hiddenCommentCount} older comment{hiddenCommentCount === 1 ? "" : "s"}
          </button>
        ) : null}
      </div>
    </PreviewSection>
  ) : preview.commentsUnavailable ? (
    <PreviewSection
      accentColor="border-l-slate-400 dark:border-l-slate-500"
      className={className}
      collapseId="comments"
      title="Comments"
    >
      <p className="text-[11px] leading-4 text-destructive">
        Comments could not be loaded. Try refreshing.
      </p>
    </PreviewSection>
  ) : null;
}
