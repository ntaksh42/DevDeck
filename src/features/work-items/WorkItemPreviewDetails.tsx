import {
  Fragment,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  MentionCandidate,
  Organization,
  WorkItemPreview,
} from "@/lib/azdoCommands";
import { commentRichHtml, richFieldHtml } from "./workItemHtml";
import { focusPrimaryGrid, formatRelativeDate, isEditableTarget } from "@/lib/utils";
import { navigateToPullRequest } from "@/lib/crossLinks";
import { openExternalUrl } from "@/lib/openExternal";
import type { CustomPreviewField, PreviewFieldKey } from "./previewFieldsStorage";
import { TitleEditor } from "./PreviewEditors";
import { WorkItemStatePill, WorkItemTypeBadge } from "./WorkItemBadges";
import { PreviewControl, PreviewField, PreviewSection, PreviewTagsField } from "./PreviewSection";
import { RichHtmlFrame } from "./RichHtmlFrame";
import { CollapsibleComment } from "./CollapsibleComment";
import { WorkItemHistorySection } from "./WorkItemHistorySection";
import { FieldConfigMenu } from "./FieldConfigMenu";
import { WorkItemLinksSection } from "./WorkItemLinksSection";
import {
  isWidePreviewField,
  previewFieldValue,
  selectedPreviewFieldDefinitions,
  stopPreviewNavigationKeyDown,
  VISIBLE_COMMENT_LIMIT,
} from "./workItemPreviewHelpers";

export { workItemStateDotClass, workItemTypeColor } from "./WorkItemBadges";

export function WorkItemPreviewDetails({
  customPreviewFields,
  preview,
  areaControl,
  assigneeControl,
  iterationControl,
  deleteCommentError,
  editCommentError,
  deletingCommentId,
  editingCommentId,
  editPending,
  actionsControl,
  deletePending,
  mentionDisplayNames,
  recentMentionOptions,
  mentionPriorityNames,
  selfOrg,
  onMentionApplied,
  onCustomPreviewFieldsChange,
  onDeleteComment,
  onEditComment,
  onToggleCommentReaction,
  reactionPendingCommentId,
  onSelectedFieldKeysChange,
  priorityControl,
  reasonControl,
  presetsControl,
  renderCustomFieldControl,
  resolveImageSource,
  selectedFieldKeys,
  stateControl,
  statusChip,
  tagsPending,
  onTagsChange,
  onTitleChange,
  titlePending,
}: {
  customPreviewFields: CustomPreviewField[];
  preview: WorkItemPreview;
  actionsControl?: ReactNode;
  areaControl?: ReactNode;
  assigneeControl: ReactNode;
  iterationControl?: ReactNode;
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
  onCustomPreviewFieldsChange: (fields: CustomPreviewField[]) => void;
  onDeleteComment: (commentId: number) => void;
  onEditComment: (commentId: number, markdown: string) => void;
  onToggleCommentReaction?: (commentId: number, reactionType: string, engaged: boolean) => void;
  reactionPendingCommentId?: number | null;
  onSelectedFieldKeysChange: (keys: PreviewFieldKey[]) => void;
  presetsControl?: ReactNode;
  priorityControl: ReactNode;
  reasonControl: ReactNode;
  renderCustomFieldControl: (field: CustomPreviewField) => ReactNode;
  resolveImageSource: (url: string) => Promise<string | null>;
  selectedFieldKeys: PreviewFieldKey[];
  stateControl: ReactNode;
  statusChip?: ReactNode;
  tagsPending: boolean;
  onTagsChange: (tags: string[]) => void;
  onTitleChange: (title: string) => void;
  titlePending: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [showAllComments, setShowAllComments] = useState(false);

  // The lightbox opens from a click inside a sandboxed comment/description
  // iframe, so focus lives in that frame; close on Escape and hand focus back to
  // the preview body rather than stranding it. Capture phase so this wins over
  // the panel's own Escape handler, which would otherwise discard staged edits
  // or jump to the grid before the lightbox ever closes.
  useEffect(() => {
    if (!lightboxSrc) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setLightboxSrc(null);
        rootRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [lightboxSrc]);

  useEffect(() => {
    setShowAllComments(false);
  }, [preview.id]);

  const visibleComments = showAllComments
    ? preview.comments
    : preview.comments.slice(0, VISIBLE_COMMENT_LIMIT);
  const hiddenCommentCount = preview.comments.length - visibleComments.length;
  const descriptionHtml = richFieldHtml(preview.descriptionHtml);
  const acceptanceCriteriaHtml = richFieldHtml(preview.acceptanceCriteriaHtml);
  const selectedFieldDefinitions = selectedPreviewFieldDefinitions(selectedFieldKeys);

  return (
    <div
      ref={rootRef}
      aria-keyshortcuts="Control+P"
      aria-label="Work item preview"
      className="min-h-0 flex-1 overflow-auto bg-card px-2.5 pb-2 pt-1.5 text-xs outline-none focus:bg-primary/[0.02]"
      data-primary-preview="true"
      onKeyDown={(event) => {
        // ← steps back to the grid (mirrors the grid's → into the preview).
        if (
          event.key === "ArrowLeft" &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !isEditableTarget(event.target)
        ) {
          event.preventDefault();
          event.stopPropagation();
          focusPrimaryGrid();
          return;
        }
        stopPreviewNavigationKeyDown(event);
      }}
      tabIndex={-1}
    >
      <div className="border-b border-border pb-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 font-mono text-[11px] leading-5 text-muted-foreground">
              #{preview.id}
            </span>
            {preview.workItemType ? (
              <WorkItemTypeBadge type={preview.workItemType} />
            ) : null}
            {preview.state ? <WorkItemStatePill state={preview.state} /> : null}
            {preview.changedDate ? (
              <span
                className="hidden shrink-0 truncate text-[10px] text-muted-foreground sm:inline"
                title={preview.changedDate}
              >
                updated {formatRelativeDate(preview.changedDate)}
              </span>
            ) : null}
            {statusChip}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {actionsControl}
            {presetsControl}
            <FieldConfigMenu
              organizationId={preview.organizationId}
              projectId={preview.projectId}
              selectedFieldKeys={selectedFieldKeys}
              onSelectedFieldKeysChange={onSelectedFieldKeysChange}
              customPreviewFields={customPreviewFields}
              onCustomPreviewFieldsChange={onCustomPreviewFieldsChange}
            />
          </div>
        </div>
        <TitleEditor current={preview.title} onSubmit={onTitleChange} pending={titlePending} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-x-2 gap-y-0.5 pt-1">
          {selectedFieldDefinitions.map((field) =>
            field.editable === "state" ? (
              <PreviewControl key={field.key} label={field.label} shortcut={field.shortcut}>
                {stateControl}
              </PreviewControl>
            ) : field.editable === "assignee" ? (
              <PreviewControl key={field.key} label={field.label} shortcut={field.shortcut}>
                {assigneeControl}
              </PreviewControl>
            ) : field.editable === "priority" ? (
              <PreviewControl key={field.key} label={field.label} shortcut={field.shortcut}>
                {priorityControl}
              </PreviewControl>
            ) : field.editable === "reason" ? (
              <PreviewControl key={field.key} label={field.label} shortcut={field.shortcut}>
                {reasonControl}
              </PreviewControl>
            ) : field.key === "areaPath" && areaControl ? (
              <PreviewControl key={field.key} label={field.label}>
                {areaControl}
              </PreviewControl>
            ) : field.key === "iterationPath" && iterationControl ? (
              <PreviewControl key={field.key} label={field.label}>
                {iterationControl}
              </PreviewControl>
            ) : field.key === "tags" ? (
              <PreviewTagsField
                key={field.key}
                label={field.label}
                value={previewFieldValue(preview, field.key)}
                pending={tagsPending}
                onChange={onTagsChange}
              />
            ) : (
              <PreviewField
                key={field.key}
                label={field.label}
                value={previewFieldValue(preview, field.key) ?? "—"}
                wide={isWidePreviewField(field.key)}
              />
            ),
          )}
          {customPreviewFields.map((field) => (
            <Fragment key={field.referenceName}>
              {renderCustomFieldControl(field)}
            </Fragment>
          ))}
        </div>
      </div>

      {(descriptionHtml || acceptanceCriteriaHtml) && (
        <div className="mt-2 grid gap-2">
          {descriptionHtml ? (
            <PreviewSection collapseId="description" title="Description">
              <RichHtmlFrame
                baseUrl={preview.webUrl}
                html={descriptionHtml}
                onImageOpen={setLightboxSrc}
                resolveImageSource={resolveImageSource}
                title="Description"
              />
            </PreviewSection>
          ) : null}
          {acceptanceCriteriaHtml ? (
            <PreviewSection collapseId="acceptanceCriteria" title="Acceptance Criteria">
              <RichHtmlFrame
                baseUrl={preview.webUrl}
                html={acceptanceCriteriaHtml}
                onImageOpen={setLightboxSrc}
                resolveImageSource={resolveImageSource}
                title="Acceptance Criteria"
              />
            </PreviewSection>
          ) : null}
        </div>
      )}

      {preview.comments.length > 0 ? (
        <PreviewSection className="mt-2" collapseId="comments" title={`Comments (${preview.comments.length})`}>
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
          <div className="space-y-1">
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
                  onImageOpen={setLightboxSrc}
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
        <PreviewSection className="mt-2" collapseId="comments" title="Comments">
          <p className="text-[11px] leading-4 text-destructive">
            Comments could not be loaded. Try refreshing.
          </p>
        </PreviewSection>
      ) : null}

      <WorkItemLinksSection preview={preview} />

      {preview.pullRequests.length > 0 ? (
        <PreviewSection
          className="mt-2"
          collapseId="pullRequests"
          title={`Pull Requests (${preview.pullRequests.length})`}
        >
          <div className="space-y-1">
            {preview.pullRequests.map((pr) => {
              const inReviews = !!pr.repositoryId;
              return (
                <button
                  key={pr.pullRequestId}
                  type="button"
                  onClick={() => {
                    if (inReviews) {
                      navigateToPullRequest({
                        organizationId: preview.organizationId,
                        repositoryId: pr.repositoryId,
                        pullRequestId: pr.pullRequestId,
                      });
                    } else if (pr.webUrl) {
                      openExternalUrl(pr.webUrl);
                    }
                  }}
                  disabled={!inReviews && !pr.webUrl}
                  className="flex w-full min-w-0 items-center gap-1.5 rounded border border-border bg-card px-1.5 py-1 text-left text-xs hover:bg-secondary disabled:cursor-default disabled:opacity-60"
                  title={
                    inReviews
                      ? "Open in My Reviews"
                      : pr.webUrl ?? "Pull request not in My Reviews"
                  }
                >
                  <span className="w-16 shrink-0 truncate text-[11px] text-muted-foreground">
                    {inReviews ? "Review" : "PR"}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-primary">
                    !{pr.pullRequestId}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {pr.title ?? "(not in My Reviews)"}
                  </span>
                  {pr.myVoteLabel ? (
                    <span className="shrink-0 rounded border border-border bg-muted px-1 py-px text-[10px] text-muted-foreground">
                      {pr.myVoteLabel}
                    </span>
                  ) : null}
                  {pr.status ? <WorkItemStatePill state={pr.status} /> : null}
                </button>
              );
            })}
          </div>
        </PreviewSection>
      ) : null}

      {preview.attachments.length > 0 ? (
        <PreviewSection
          className="mt-2"
          collapseId="attachments"
          title={`Attachments (${preview.attachments.length})`}
        >
          <div className="space-y-1">
            {preview.attachments.map((attachment) => (
              <button
                key={attachment.url}
                type="button"
                onClick={() => openExternalUrl(attachment.url)}
                title={`Download ${attachment.name}`}
                aria-label={`Download attachment ${attachment.name}`}
                className="flex w-full min-w-0 items-center gap-1.5 rounded border border-border bg-card px-1.5 py-1 text-left text-xs hover:bg-secondary"
              >
                <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                <span className="shrink-0 text-[11px] text-primary">Download</span>
              </button>
            ))}
          </div>
        </PreviewSection>
      ) : null}

      <WorkItemHistorySection preview={preview} />
      {lightboxSrc ? (
        <button
          type="button"
          autoFocus
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/75 p-6"
          onClick={() => {
            setLightboxSrc(null);
            rootRef.current?.focus();
          }}
          aria-label="Close image preview"
        >
          <img
            src={lightboxSrc}
            alt=""
            className="max-h-full max-w-full rounded-md bg-white object-contain shadow-2xl"
          />
        </button>
      ) : null}
    </div>
  );
}
