import {
  type FormEvent,
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, Loader2, Pencil, Plus, SlidersHorizontal, SmilePlus, Trash2, X } from "lucide-react";
import type {
  WorkItemFieldOption,
  WorkItemPreview,
} from "@/lib/azdoCommands";
import { commandErrorMessage, listWorkItemFields, listWorkItemUpdates } from "@/lib/azdoCommands";
import { focusPrimaryGrid, formatRelativeDate, isEditableTarget } from "@/lib/utils";
import { openExternalUrl } from "@/lib/openExternal";
import { navigateToPullRequest } from "@/lib/crossLinks";
import { readStoredJson, writeStoredJson } from "@/lib/storage";
import { ShortcutHint } from "@/components/ShortcutHint";
import { workItemQueryKeys } from "./queryKeys";
import {
  DEFAULT_PREVIEW_FIELD_KEYS,
  isValidFieldReferenceName,
  storeCustomPreviewFields,
  type CustomPreviewField,
  type PreviewFieldKey,
} from "./previewFieldsStorage";
import { splitWorkItemTags } from "./workItemChanges";
import {
  buildRichHtmlDocument,
  commentAuthorInitials,
  commentRichHtml,
  hydrateAuthenticatedImages,
  richFieldHtml,
} from "./workItemHtml";
import { useCloseOnOutsidePointer } from "./PreviewEditors";

type PreviewFieldDefinition = {
  editable?: "state" | "assignee" | "priority" | "reason";
  key: PreviewFieldKey;
  label: string;
  shortcut?: string;
};

const PREVIEW_FIELD_DEFINITIONS: PreviewFieldDefinition[] = [
  { key: "state", label: "State", editable: "state", shortcut: "S" },
  { key: "assignedTo", label: "Assigned", editable: "assignee", shortcut: "A" },
  { key: "priority", label: "Priority", editable: "priority", shortcut: "P" },
  { key: "areaPath", label: "Area" },
  { key: "iterationPath", label: "Iteration" },
  { key: "reason", label: "Reason", editable: "reason", shortcut: "R" },
  { key: "severity", label: "Severity" },
  { key: "storyPoints", label: "Points" },
  { key: "remainingWork", label: "Remain" },
  { key: "tags", label: "Tags" },
  { key: "workItemType", label: "Type" },
  { key: "projectName", label: "Project" },
  { key: "createdBy", label: "Created by" },
  { key: "createdDate", label: "Created" },
  { key: "changedDate", label: "Changed" },
];

const VISIBLE_COMMENT_LIMIT = 20;

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


function stopPreviewNavigationKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
  if (
    event.key === 'ArrowDown' ||
    event.key === 'ArrowUp' ||
    event.key === 'ArrowLeft' ||
    event.key === 'ArrowRight' ||
    event.key === 'PageDown' ||
    event.key === 'PageUp' ||
    event.key === 'Home' ||
    event.key === 'End' ||
    event.key === ' '
  ) {
    event.stopPropagation();
  }
}

export function WorkItemPreviewDetails({
  customPreviewFields,
  preview,
  assigneeControl,
  deleteCommentError,
  editCommentError,
  deletingCommentId,
  editingCommentId,
  editPending,
  actionsControl,
  deletePending,
  mentionDisplayNames,
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
}: {
  customPreviewFields: CustomPreviewField[];
  preview: WorkItemPreview;
  actionsControl?: ReactNode;
  assigneeControl: ReactNode;
  deleteCommentError: string | null;
  editCommentError: string | null;
  deletingCommentId: number | null;
  editingCommentId: number | null;
  editPending: boolean;
  deletePending: boolean;
  mentionDisplayNames: ReadonlyMap<string, string>;
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
}) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  // Comments arrive newest first; only the recent ones mount their iframe by
  // default because each comment is a full sandboxed document.
  const [showAllComments, setShowAllComments] = useState(false);
  useEffect(() => {
    setShowAllComments(false);
  }, [preview.id]);
  const visibleComments = showAllComments
    ? preview.comments
    : preview.comments.slice(0, VISIBLE_COMMENT_LIMIT);
  const hiddenCommentCount = preview.comments.length - visibleComments.length;
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);
  const [customFieldLabel, setCustomFieldLabel] = useState("");
  const [customFieldReferenceName, setCustomFieldReferenceName] = useState("");
  const [customFieldSearch, setCustomFieldSearch] = useState("");
  const [customFieldError, setCustomFieldError] = useState<string | null>(null);
  const fieldMenuRef = useCloseOnOutsidePointer<HTMLDivElement>(
    fieldMenuOpen,
    () => setFieldMenuOpen(false),
  );
  const selectedFieldDefinitions = selectedPreviewFieldDefinitions(selectedFieldKeys);
  const fieldOptionsQuery = useQuery({
    queryKey: workItemQueryKeys.fields(preview.organizationId, preview.projectId),
    queryFn: () =>
      listWorkItemFields({
        organizationId: preview.organizationId,
        projectId: preview.projectId,
      }),
    enabled: fieldMenuOpen,
    staleTime: 10 * 60_000,
  });
  const customFieldOptions = useMemo(
    () =>
      filterCustomFieldOptions(
        fieldOptionsQuery.data ?? [],
        customPreviewFields,
        customFieldSearch,
      ),
    [customFieldSearch, customPreviewFields, fieldOptionsQuery.data],
  );

  const descriptionHtml = richFieldHtml(preview.descriptionHtml);
  const acceptanceCriteriaHtml = richFieldHtml(preview.acceptanceCriteriaHtml);

  function toggleField(key: PreviewFieldKey) {
    onSelectedFieldKeysChange(
      selectedFieldKeys.includes(key)
        ? selectedFieldKeys.filter((value) => value !== key)
        : [...selectedFieldKeys, key],
    );
  }

  function addCustomField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const referenceName = customFieldReferenceName.trim();
    const label = customFieldLabel.trim() || referenceName;
    if (!isValidFieldReferenceName(referenceName)) {
      setCustomFieldError("Use a field reference name like Custom.ReleaseTrain.");
      return;
    }
    if (customPreviewFields.some((field) => field.referenceName.toLowerCase() === referenceName.toLowerCase())) {
      setCustomFieldError("That field is already shown.");
      return;
    }
    const next = [...customPreviewFields, { referenceName, label }];
    storeCustomPreviewFields(next);
    onCustomPreviewFieldsChange(next);
    setCustomFieldLabel("");
    setCustomFieldReferenceName("");
    setCustomFieldError(null);
  }

  function addCustomFieldOption(option: WorkItemFieldOption) {
    const next = [
      ...customPreviewFields,
      { referenceName: option.referenceName, label: option.name || option.referenceName },
    ];
    storeCustomPreviewFields(next);
    onCustomPreviewFieldsChange(next);
    setCustomFieldSearch("");
    setCustomFieldError(null);
  }

  function removeCustomField(referenceName: string) {
    const next = customPreviewFields.filter((field) => field.referenceName !== referenceName);
    storeCustomPreviewFields(next);
    onCustomPreviewFieldsChange(next);
  }

  return (
    <div
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
            <div ref={fieldMenuRef} className="relative">
              <button
                type="button"
                aria-expanded={fieldMenuOpen}
                aria-label="Configure preview fields"
                title="Configure preview fields"
                onClick={() => setFieldMenuOpen((open) => !open)}
                className="inline-flex h-5 w-5 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
              </button>
              {fieldMenuOpen ? (
                <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-md border border-border bg-popover p-1 shadow-lg">
                  <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                    Show attributes
                  </div>
                  <div className="max-h-64 overflow-auto">
                    {PREVIEW_FIELD_DEFINITIONS.map((field) => (
                      <label
                        key={field.key}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted"
                      >
                        <input
                          type="checkbox"
                          checked={selectedFieldKeys.includes(field.key)}
                          onChange={() => toggleField(field.key)}
                          className="h-3.5 w-3.5"
                        />
                        <span className="min-w-0 flex-1 truncate">{field.label}</span>
                        {field.editable ? (
                          <span className="rounded border border-border bg-background px-1 text-[10px] text-muted-foreground">
                            editable
                          </span>
                        ) : null}
                      </label>
                    ))}
                  </div>
                  <div className="mt-1 border-t border-border px-2 py-1.5">
                    <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
                      Custom attributes
                    </div>
                    <input
                      value={customFieldSearch}
                      onChange={(event) => setCustomFieldSearch(event.target.value)}
                      placeholder="Search fields from Azure DevOps"
                      className="mb-1 h-7 w-full rounded border border-input bg-background px-2 text-[11px] outline-none focus:ring-2 focus:ring-ring"
                    />
                    <div className="mb-1.5 max-h-28 overflow-auto rounded border border-border bg-muted">
                      {fieldOptionsQuery.isFetching ? (
                        <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                          Loading fields...
                        </div>
                      ) : fieldOptionsQuery.isError ? (
                        <div className="px-2 py-1.5 text-[11px] text-destructive">
                          {commandErrorMessage(fieldOptionsQuery.error)}
                        </div>
                      ) : customFieldOptions.length > 0 ? (
                        customFieldOptions.map((field) => (
                          <button
                            key={field.referenceName}
                            type="button"
                            onClick={() => addCustomFieldOption(field)}
                            className="flex w-full min-w-0 items-center gap-2 px-2 py-1 text-left text-[11px] hover:bg-accent"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{field.name}</span>
                              <span className="block truncate font-mono text-[10px] text-muted-foreground">
                                {field.referenceName}
                              </span>
                            </span>
                            <span className="shrink-0 rounded border border-border bg-card px-1 text-[10px] text-muted-foreground">
                              {field.fieldType}
                            </span>
                          </button>
                        ))
                      ) : (
                        <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                          {fieldOptionsQuery.isSuccess ? "No matching fields" : "Open to load fields"}
                        </div>
                      )}
                    </div>
                    {customPreviewFields.length > 0 ? (
                      <div className="mb-1.5 grid gap-1">
                        {customPreviewFields.map((field) => (
                          <div
                            key={field.referenceName}
                            className="flex min-w-0 items-center gap-1 rounded bg-muted px-1.5 py-1"
                          >
                            <span className="min-w-0 flex-1 truncate text-[11px]" title={field.referenceName}>
                              {field.label}
                            </span>
                            <button
                              type="button"
                              aria-label={`Remove ${field.label}`}
                              title="Remove"
                              onClick={() => removeCustomField(field.referenceName)}
                              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <form className="grid gap-1" onSubmit={addCustomField}>
                      <input
                        value={customFieldReferenceName}
                        onChange={(event) => {
                          setCustomFieldReferenceName(event.target.value);
                          setCustomFieldError(null);
                        }}
                        placeholder="Custom.ReleaseTrain"
                        className="h-7 rounded border border-input bg-background px-2 font-mono text-[11px] outline-none focus:ring-2 focus:ring-ring"
                      />
                      <div className="flex items-center gap-1">
                        <input
                          value={customFieldLabel}
                          onChange={(event) => setCustomFieldLabel(event.target.value)}
                          placeholder="Label"
                          className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-[11px] outline-none focus:ring-2 focus:ring-ring"
                        />
                        <button
                          type="submit"
                          title="Add custom field"
                          aria-label="Add custom field"
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border hover:bg-secondary"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                      {customFieldError ? (
                        <p className="text-[10px] leading-3 text-destructive">{customFieldError}</p>
                      ) : null}
                    </form>
                  </div>
                  <div className="mt-1 flex items-center justify-between border-t border-border pt-1">
                    <button
                      type="button"
                      onClick={() => onSelectedFieldKeysChange(DEFAULT_PREVIEW_FIELD_KEYS)}
                      className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => setFieldMenuOpen(false)}
                      className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <h2
          className="mt-0.5 line-clamp-2 text-sm font-semibold leading-5 text-foreground"
          title={preview.title}
        >
          {preview.title}
        </h2>
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

      {preview.relations.length > 0 ? (
        <PreviewSection className="mt-2" collapseId="links" title={`Links (${preview.relations.length})`}>
          <div className="space-y-1">
            {preview.relations.map((relation) => (
              <button
                key={`${relation.relationType}:${relation.id}`}
                type="button"
                onClick={() => {
                  if (relation.webUrl) openExternalUrl(relation.webUrl);
                }}
                className="flex w-full min-w-0 items-center gap-1.5 rounded border border-border bg-card px-1.5 py-1 text-left text-xs hover:bg-secondary"
                title={relation.webUrl ?? undefined}
              >
                <span className="w-16 shrink-0 truncate text-[11px] text-muted-foreground">
                  {relation.relationType}
                </span>
                {relation.workItemType ? (
                  <WorkItemTypeBadge type={relation.workItemType} />
                ) : null}
                <span className="shrink-0 font-mono text-[11px] text-primary">
                  #{relation.id}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {relation.title ?? "(unresolved)"}
                </span>
                {relation.state ? <WorkItemStatePill state={relation.state} /> : null}
              </button>
            ))}
          </div>
        </PreviewSection>
      ) : null}

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
      <WorkItemHistorySection preview={preview} />
      {lightboxSrc ? (
        <button
          type="button"
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/75 p-6"
          onClick={() => setLightboxSrc(null)}
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

function workItemFieldLabel(referenceName: string): string {
  return referenceName.split(".").pop() || referenceName;
}

function WorkItemHistorySection({ preview }: { preview: WorkItemPreview }) {
  const [open, setOpen] = useState(false);
  const updatesQuery = useQuery({
    queryKey: workItemQueryKeys.updates(
      preview.organizationId,
      preview.projectId,
      preview.id,
    ),
    queryFn: () =>
      listWorkItemUpdates({
        organizationId: preview.organizationId,
        projectId: preview.projectId,
        workItemId: preview.id,
      }),
    enabled: open,
    staleTime: 60_000,
  });
  const updates = updatesQuery.data ?? [];

  return (
    <section className="mt-2 min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        History
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        {open && updatesQuery.isFetching ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        ) : null}
      </button>
      {open ? (
        updatesQuery.isError ? (
          <p className="mt-1 text-[11px] text-destructive">
            {commandErrorMessage(updatesQuery.error)}
          </p>
        ) : updates.length === 0 && !updatesQuery.isFetching ? (
          <p className="mt-1 text-[11px] text-muted-foreground">No field changes recorded.</p>
        ) : (
          <div className="mt-1 space-y-1.5">
            {updates.map((update) => (
              <article
                key={update.id}
                className="min-w-0 rounded border border-border bg-card px-1.5 py-1"
              >
                <div className="flex min-w-0 items-baseline gap-1.5 text-[11px]">
                  <span className="min-w-0 truncate font-semibold">
                    {update.revisedBy ?? "Unknown"}
                  </span>
                  {update.revisedDate ? (
                    <span
                      className="shrink-0 text-muted-foreground"
                      title={new Date(update.revisedDate).toLocaleString()}
                    >
                      {formatRelativeDate(update.revisedDate)}
                    </span>
                  ) : null}
                </div>
                <ul className="mt-0.5 space-y-0.5">
                  {update.changes.map((change) => (
                    <li
                      key={change.referenceName}
                      className="flex min-w-0 flex-wrap items-baseline gap-1 text-[11px] leading-4"
                      title={change.referenceName}
                    >
                      <span className="text-muted-foreground">
                        {workItemFieldLabel(change.referenceName)}:
                      </span>
                      {change.oldValue ? (
                        <>
                          <span className="truncate text-muted-foreground line-through">
                            {change.oldValue}
                          </span>
                          <span aria-hidden="true" className="text-muted-foreground">→</span>
                        </>
                      ) : null}
                      <span className="truncate font-medium">{change.newValue ?? "(cleared)"}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}

function CollapsibleComment({
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
  const [expanded, setExpanded] = useState(commentHtml.length < 700);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState(commentText ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const collapsible = commentHtml.length >= 700;
  const reactionByType = new Map(reactions.map((reaction) => [reaction.reactionType, reaction]));

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
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-semibold text-blue-700">
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
            <div className={expanded ? "" : "max-h-32 overflow-hidden"}>
              <RichHtmlFrame
                baseUrl={baseUrl}
                density="compact"
                framed={false}
                html={commentHtml}
                title={`Comment by ${createdBy ?? "Unknown"}`}
                resolveImageSource={resolveImageSource}
                onImageOpen={onImageOpen}
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

function selectedPreviewFieldDefinitions(keys: PreviewFieldKey[]): PreviewFieldDefinition[] {
  const selected = new Set(keys);
  return PREVIEW_FIELD_DEFINITIONS.filter((field) => selected.has(field.key));
}

function isWidePreviewField(key: PreviewFieldKey): boolean {
  return key === "areaPath" || key === "iterationPath" || key === "tags";
}

function previewFieldValue(preview: WorkItemPreview, key: PreviewFieldKey): string | null {
  switch (key) {
    case "state":
      return preview.state;
    case "assignedTo":
      return preview.assignedTo;
    case "priority":
      return preview.priority;
    case "areaPath":
      return preview.areaPath;
    case "iterationPath":
      return preview.iterationPath;
    case "reason":
      return preview.reason;
    case "severity":
      return preview.severity;
    case "storyPoints":
      return preview.storyPoints;
    case "remainingWork":
      return preview.remainingWork;
    case "tags":
      return preview.tags;
    case "workItemType":
      return preview.workItemType;
    case "projectName":
      return preview.projectName;
    case "createdBy":
      return preview.createdBy;
    case "createdDate":
      return preview.createdDate ? formatRelativeDate(preview.createdDate) : null;
    case "changedDate":
      return preview.changedDate ? formatRelativeDate(preview.changedDate) : null;
  }
}

function filterCustomFieldOptions(
  options: WorkItemFieldOption[],
  selectedFields: CustomPreviewField[],
  query: string,
): WorkItemFieldOption[] {
  const selected = new Set(selectedFields.map((field) => field.referenceName.toLowerCase()));
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return options
    .filter((option) => !selected.has(option.referenceName.toLowerCase()))
    .filter((option) => {
      if (terms.length === 0) return option.custom;
      const haystack = `${option.name} ${option.referenceName} ${option.fieldType}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .sort((left, right) =>
      Number(right.custom) - Number(left.custom) ||
      left.name.localeCompare(right.name) ||
      left.referenceName.localeCompare(right.referenceName),
    )
    .slice(0, 20);
}

function PreviewControl({
  children,
  label,
  shortcut,
}: {
  children: ReactNode;
  label: string;
  shortcut?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-[10px] font-semibold uppercase leading-4 text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center leading-4">{children}</div>
      {shortcut ? <ShortcutHint>{shortcut}</ShortcutHint> : null}
    </div>
  );
}

function PreviewField({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div
      className={`flex min-w-0 items-baseline gap-1.5 ${
        wide ? "sm:col-span-2 2xl:col-span-3" : ""
      }`}
    >
      <dt className="shrink-0 text-[10px] font-semibold uppercase leading-4 text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`min-w-0 flex-1 text-[12px] font-semibold leading-4 text-foreground ${
          wide ? "break-words" : "truncate"
        }`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

const WI_PREVIEW_COLLAPSED_SECTIONS_STORAGE_KEY =
  "azdodeck:view:wiPreviewCollapsedSections:v1";

function loadCollapsedPreviewSections(): Set<string> {
  return readStoredJson(
    WI_PREVIEW_COLLAPSED_SECTIONS_STORAGE_KEY,
    (raw) =>
      Array.isArray(raw)
        ? new Set(raw.filter((value): value is string => typeof value === "string"))
        : undefined,
    new Set(),
  );
}

function storeCollapsedPreviewSections(collapsed: Set<string>) {
  writeStoredJson(WI_PREVIEW_COLLAPSED_SECTIONS_STORAGE_KEY, [...collapsed]);
}

function PreviewSection({
  children,
  className = "",
  collapseId,
  title,
}: {
  children: ReactNode;
  className?: string;
  collapseId?: string;
  title: string;
}) {
  const [collapsed, setCollapsed] = useState(() =>
    collapseId ? loadCollapsedPreviewSections().has(collapseId) : false,
  );

  function toggleCollapsed() {
    if (!collapseId) return;
    setCollapsed((current) => {
      const next = !current;
      const stored = loadCollapsedPreviewSections();
      if (next) stored.add(collapseId);
      else stored.delete(collapseId);
      storeCollapsedPreviewSections(stored);
      return next;
    });
  }

  return (
    <section className={`min-w-0 ${className}`}>
      <div className="sticky top-0 z-10 mb-1 border-t border-border bg-card/95 pb-0.5 pt-1 backdrop-blur-sm">
        {collapseId ? (
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={toggleCollapsed}
            className="flex w-full items-center gap-1 rounded text-left hover:bg-muted/60 focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <ChevronRight
              className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${
                collapsed ? "" : "rotate-90"
              }`}
              aria-hidden="true"
            />
            <h3 className="text-[11px] font-semibold leading-4 text-foreground/75">
              {title}
            </h3>
          </button>
        ) : (
          <h3 className="text-[11px] font-semibold leading-4 text-foreground/75">
            {title}
          </h3>
        )}
      </div>
      {collapsed ? null : children}
    </section>
  );
}

// Azure DevOps standard work item type colors, keyed by lowercase type name.
const WORK_ITEM_TYPE_COLORS: Record<string, string> = {
  bug: "#CC293D",
  task: "#F2CB1D",
  "user story": "#009CCC",
  "product backlog item": "#009CCC",
  requirement: "#009CCC",
  feature: "#773B93",
  epic: "#FF7B00",
  issue: "#B4009E",
  impediment: "#B4009E",
  "test case": "#004B50",
};

export function workItemTypeColor(workItemType: string): string {
  return WORK_ITEM_TYPE_COLORS[workItemType.trim().toLowerCase()] ?? "#64748B";
}

export function workItemStateDotClass(state: string): string {
  const normalized = state.trim().toLowerCase();
  if (["done", "closed", "completed", "inactive"].includes(normalized)) {
    return "bg-green-500";
  }
  if (normalized === "resolved") return "bg-amber-500";
  if (
    ["active", "in progress", "doing", "committed", "open"].includes(normalized)
  ) {
    return "bg-blue-500";
  }
  if (normalized === "removed") return "bg-slate-300";
  // New / To Do / Proposed / Approved and unknown custom states.
  return "bg-slate-400";
}

function WorkItemTypeBadge({ type }: { type: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 rounded border border-border bg-card px-1.5 text-[11px] font-medium leading-[18px] text-foreground">
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-[2px]"
        style={{ backgroundColor: workItemTypeColor(type) }}
      />
      <span className="truncate">{type}</span>
    </span>
  );
}

function WorkItemStatePill({ state }: { state: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-border bg-card px-1.5 text-[11px] leading-[18px] text-foreground">
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${workItemStateDotClass(state)}`}
      />
      <span className="truncate">{state}</span>
    </span>
  );
}

function PreviewTagsField({
  label,
  value,
  pending = false,
  onChange,
}: {
  label: string;
  value: string | null;
  pending?: boolean;
  onChange?: (tags: string[]) => void;
}) {
  const tags = splitWorkItemTags(value);
  const [draft, setDraft] = useState("");

  function addDraftTag() {
    const tag = draft.trim();
    if (!tag || !onChange) return;
    setDraft("");
    if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return;
    onChange([...tags, tag]);
  }

  return (
    <div className="flex min-w-0 items-baseline gap-1.5 sm:col-span-2 2xl:col-span-3">
      <dt className="shrink-0 text-[10px] font-semibold uppercase leading-4 text-muted-foreground">
        {label}
      </dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {tags.length === 0 && !onChange ? (
          <span className="text-[12px] font-semibold leading-4 text-foreground">—</span>
        ) : (
          tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex max-w-full items-center gap-0.5 truncate rounded-sm border border-border bg-secondary px-1 text-[10px] font-medium leading-4 text-secondary-foreground"
              title={tag}
            >
              {tag}
              {onChange ? (
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  disabled={pending}
                  onClick={() => onChange(tags.filter((existing) => existing !== tag))}
                  className="rounded text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <X className="h-2.5 w-2.5" aria-hidden="true" />
                </button>
              ) : null}
            </span>
          ))
        )}
        {onChange ? (
          <input
            value={draft}
            disabled={pending}
            placeholder="+ tag"
            aria-label="Add tag"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              stopPreviewNavigationKeyDown(event);
              if (event.key === "Enter") {
                event.preventDefault();
                addDraftTag();
              }
            }}
            onBlur={addDraftTag}
            className="w-16 min-w-0 rounded-sm border border-transparent bg-transparent px-1 text-[10px] leading-4 outline-none placeholder:text-muted-foreground/60 focus:border-input focus:bg-background disabled:opacity-50"
          />
        ) : null}
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : null}
      </dd>
    </div>
  );
}

function RichHtmlFrame({
  baseUrl,
  density = "compact",
  framed = true,
  html,
  minHeight = 40,
  onImageOpen,
  resolveImageSource,
  title,
}: {
  baseUrl?: string | null;
  density?: "compact" | "comfortable";
  framed?: boolean;
  html: string;
  minHeight?: number;
  onImageOpen?: (src: string) => void;
  resolveImageSource?: (url: string) => Promise<string | null>;
  title: string;
}) {
  const [height, setHeight] = useState(minHeight);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const srcDoc = useMemo(() => buildRichHtmlDocument(html, density), [density, html]);

  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, []);

  return (
    <iframe
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-same-origin"
      scrolling="no"
      className={`block w-full bg-white ${framed ? "rounded border border-border" : ""}`}
      style={{ height }}
      onLoad={(event) => {
        const frame = event.currentTarget;
        const doc = frame.contentDocument;
        const body = doc?.body;
        if (!body) return;
        const syncHeight = () => {
          setHeight(Math.max(minHeight, Math.ceil(body.scrollHeight)));
        };
        syncHeight();
        frame.contentWindow?.requestAnimationFrame(syncHeight);
        doc.querySelectorAll("img, video").forEach((media) => {
          media.addEventListener("load", syncHeight, { once: true });
          media.addEventListener("error", syncHeight, { once: true });
        });
        doc.querySelectorAll("img").forEach((image) => {
          image.addEventListener("click", () => {
            if (image.src) onImageOpen?.(image.src);
          });
        });
        hydrateAuthenticatedImages(doc, baseUrl, resolveImageSource, syncHeight);
        resizeObserverRef.current?.disconnect();
        const frameWindow = frame.contentWindow as
          | (Window & { ResizeObserver?: typeof ResizeObserver })
          | null;
        const ResizeObserverCtor = frameWindow?.ResizeObserver;
        if (ResizeObserverCtor) {
          const resizeObserver = new ResizeObserverCtor(syncHeight);
          resizeObserver.observe(body);
          resizeObserverRef.current = resizeObserver;
        }
      }}
    />
  );
}


// Named bundles of field changes ("Resolve as Won't Fix", ...). Applying one
// stages its changes; saving captures the current pending changes.
