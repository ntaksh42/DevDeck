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
import { richFieldHtml } from "./workItemHtml";
import { focusPrimaryGrid, formatRelativeDate, isEditableTarget } from "@/lib/utils";
import { readStoredJson, writeStoredJson } from "@/lib/storage";
import { Columns2, Rows2 } from "lucide-react";
import type { CustomPreviewField, PreviewFieldKey } from "./previewFieldsStorage";
import { TitleEditor } from "./PreviewEditors";
import { WorkItemStatePill, WorkItemTypeBadge } from "./WorkItemBadges";
import { WorkItemAttachmentsSection, WorkItemPullRequestsSection } from "./WorkItemPreviewLinkedSections";
import { usePreviewSectionMover } from "./PreviewSectionMover";
import { type PreviewSectionId, sectionColumn } from "./previewSectionLayout";
import { PreviewControl, PreviewField, PreviewSection, PreviewTagsField } from "./PreviewSection";
import { RichHtmlFrame } from "./RichHtmlFrame";
import { PreviewToolbarPortal } from "@/components/PreviewToolbarSlot";
import { WorkItemCommentsSection } from "./WorkItemCommentsSection";
import { WorkItemHistorySection } from "./WorkItemHistorySection";
import { FieldConfigMenu } from "./FieldConfigMenu";
import { WorkItemLinksSection } from "./WorkItemLinksSection";
import {
  isWidePreviewField,
  previewFieldValue,
  selectedPreviewFieldDefinitions,
  stopPreviewNavigationKeyDown,
} from "./workItemPreviewHelpers";

export { workItemStateDotClass, workItemTypeColor } from "./WorkItemBadges";

/** Panel width (CSS px, before zoom) at which comments go beside the details by default. */
const SIDE_BY_SIDE_MIN_WIDTH = 880;
const COMMENTS_LAYOUT_KEY = "azdodeck:wiPreview:commentsLayout";
type CommentsLayout = "auto" | "side" | "below";

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
  zoom,
  zoomControl,
  composer,
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
  zoom: number;
  zoomControl?: ReactNode;
  /** The new-comment box; follows the comments into the side column. */
  composer?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  // Comments (and the composer) either sit in a column beside the details or
  // follow them below. Until the user picks one with the header toggle, wide
  // panels go beside and narrow ones below.
  const [wideEnough, setWideEnough] = useState(false);
  const [commentsLayout, setCommentsLayout] = useState<CommentsLayout>(() =>
    readStoredJson<CommentsLayout>(
      COMMENTS_LAYOUT_KEY,
      (raw) => (raw === "side" || raw === "below" ? raw : undefined),
      "auto",
    ),
  );
  const sideBySide = commentsLayout === "side" || (commentsLayout === "auto" && wideEnough);

  function toggleCommentsLayout() {
    const next = sideBySide ? "below" : "side";
    setCommentsLayout(next);
    writeStoredJson(COMMENTS_LAYOUT_KEY, next);
  }

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setWideEnough(entry.contentRect.width >= SIDE_BY_SIDE_MIN_WIDTH);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  const comments = (
    <WorkItemCommentsSection
      preview={preview}
      deleteCommentError={deleteCommentError}
      editCommentError={editCommentError}
      deletingCommentId={deletingCommentId}
      editingCommentId={editingCommentId}
      editPending={editPending}
      deletePending={deletePending}
      mentionDisplayNames={mentionDisplayNames}
      recentMentionOptions={recentMentionOptions}
      mentionPriorityNames={mentionPriorityNames}
      selfOrg={selfOrg}
      onMentionApplied={onMentionApplied}
      onDeleteComment={onDeleteComment}
      onEditComment={onEditComment}
      onToggleCommentReaction={onToggleCommentReaction}
      reactionPendingCommentId={reactionPendingCommentId}
      resolveImageSource={resolveImageSource}
      onImageOpen={setLightboxSrc}
    />
  );
  const descriptionHtml = richFieldHtml(preview.descriptionHtml);
  const acceptanceCriteriaHtml = richFieldHtml(preview.acceptanceCriteriaHtml);
  const selectedFieldDefinitions = selectedPreviewFieldDefinitions(selectedFieldKeys);
  const hasComments = preview.comments.length > 0 || preview.commentsUnavailable;
  const visibleSections = new Set<PreviewSectionId>(["links", "history"]);
  if (descriptionHtml) visibleSections.add("description");
  if (acceptanceCriteriaHtml) visibleSections.add("acceptanceCriteria");
  if (hasComments) visibleSections.add("comments");
  if (preview.pullRequests.length > 0) visibleSections.add("pullRequests");
  if (preview.attachments.length > 0) visibleSections.add("attachments");
  const sections = usePreviewSectionMover({
    scopeRef: outerRef,
    sideBySide,
    visible: visibleSections,
  });
  const mainColumn = sideBySide ? "main" : null;
  const commentsInSide = sideBySide && sectionColumn(sections.layout, "comments") === "side";

  function renderSection(id: PreviewSectionId): ReactNode {
    switch (id) {
      case "description":
      case "acceptanceCriteria": {
        const title = id === "description" ? "Description" : "Acceptance Criteria";
        return (
          <PreviewSection accentColor="border-l-primary" collapseId={id} title={title}>
            {/* Unframed: the section band already marks where the field starts. */}
            <RichHtmlFrame
              baseUrl={preview.webUrl}
              framed={false}
              html={(id === "description" ? descriptionHtml : acceptanceCriteriaHtml) ?? ""}
              onImageOpen={setLightboxSrc}
              resolveImageSource={resolveImageSource}
              title={title}
            />
          </PreviewSection>
        );
      }
      case "comments":
        return comments;
      case "links":
        return <WorkItemLinksSection preview={preview} />;
      case "pullRequests":
        return <WorkItemPullRequestsSection preview={preview} />;
      case "attachments":
        return <WorkItemAttachmentsSection preview={preview} />;
      case "history":
        return <WorkItemHistorySection preview={preview} />;
    }
  }

  const details = (
    <div
      ref={rootRef}
      aria-keyshortcuts="Control+P"
      aria-label="Work item preview"
      className={`min-h-0 flex-1 overflow-auto bg-card px-2.5 pb-2 pt-1.5 text-xs outline-none focus:bg-primary/[0.02] ${
        sections.dragging ? "[&_iframe]:pointer-events-none" : ""
      }`}
      data-primary-preview="true"
      {...sections.columnDropProps(mainColumn)}
      style={sideBySide ? undefined : { zoom }}
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
      <div className="border-b-2 border-border pb-1.5">
        <TitleEditor current={preview.title} onSubmit={onTitleChange} pending={titlePending} />
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 font-mono text-[11px] font-bold leading-5 text-slate-600 dark:text-slate-300">
              #{preview.id}
            </span>
            {/* Type and state stay whole; the "updated" text is what gives way. */}
            {preview.workItemType ? (
              <span className="shrink-0">
                <WorkItemTypeBadge type={preview.workItemType} />
              </span>
            ) : null}
            {preview.state ? (
              <span className="shrink-0">
                <WorkItemStatePill state={preview.state} />
              </span>
            ) : null}
            {preview.changedDate ? (
              <span
                className="hidden min-w-0 truncate text-[11px] font-medium text-slate-500 dark:text-slate-400 sm:inline"
                title={preview.changedDate}
              >
                updated {formatRelativeDate(preview.changedDate)}
              </span>
            ) : null}
            {statusChip}
          </div>
          {/* In the dock tab strip when the host provides a slot (Work Items
              grid); inline at the end of this row otherwise (board, PR pane). */}
          <PreviewToolbarPortal>
            <div className="flex shrink-0 items-center gap-1">
              {actionsControl}
              {presetsControl}
              {zoomControl}
              <button
                type="button"
                onClick={toggleCommentsLayout}
                aria-pressed={sideBySide}
                aria-label={sideBySide ? "Show comments below the details" : "Show comments beside the details"}
                title={sideBySide ? "Show comments below the details" : "Show comments beside the details"}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {sideBySide ? (
                  <Rows2 className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Columns2 className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
              <FieldConfigMenu
                organizationId={preview.organizationId}
                projectId={preview.projectId}
                selectedFieldKeys={selectedFieldKeys}
                onSelectedFieldKeysChange={onSelectedFieldKeysChange}
                customPreviewFields={customPreviewFields}
                onCustomPreviewFieldsChange={onCustomPreviewFieldsChange}
              />
            </div>
          </PreviewToolbarPortal>
        </div>
        {/* Chips instead of a fixed-column grid: a short value (e.g. Priority
            "2") only takes the width its own text needs rather than a forced
            minmax(120px,...) column, so more fields pack per row and the
            block doesn't leave dead space when values are short. */}
        <div className="flex flex-wrap items-center gap-1 pt-1.5">
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
              // An unset Reason ("—") is common (only certain states use it)
              // and not worth a whole chip's worth of dead space.
              previewFieldValue(preview, field.key) ? (
                <PreviewControl key={field.key} label={field.label} shortcut={field.shortcut}>
                  {reasonControl}
                </PreviewControl>
              ) : null
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

      {sections.renderColumn(mainColumn, renderSection)}
      {sections.appendIndicator(mainColumn)}
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

  return (
    <div ref={outerRef} className="flex min-h-0 flex-1 flex-col">
      {sideBySide ? (
        <div className="flex min-h-0 flex-1" style={{ zoom }}>
          <div className="flex min-w-0 flex-1 flex-col">
            {details}
            {commentsInSide ? null : composer}
          </div>
          <div className="flex w-[42%] min-w-48 max-w-xl shrink-0 flex-col border-l border-border bg-card text-xs">
            <div
              className={`min-h-0 flex-1 overflow-auto px-2 pb-2 pt-1.5 ${
                sections.dragging ? "[&_iframe]:pointer-events-none" : ""
              }`}
              {...sections.columnDropProps("side")}
            >
              {sections.renderColumn("side", renderSection)}
              {sections.appendIndicator("side")}
              {commentsInSide && !hasComments ? (
                <p className="px-1 py-2 text-muted-foreground">No comments yet.</p>
              ) : sections.visibleIn("side").length === 0 ? (
                <p className="rounded border border-dashed border-border px-2 py-3 text-center text-[11px] text-muted-foreground">
                  Drag a section header here (or focus it and press Alt+→).
                </p>
              ) : null}
            </div>
            {commentsInSide ? composer : null}
          </div>
        </div>
      ) : (
        <>
          {details}
          {composer}
        </>
      )}
    </div>
  );
}
