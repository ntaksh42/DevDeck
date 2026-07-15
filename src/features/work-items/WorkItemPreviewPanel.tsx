import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  commandErrorMessage,
  type MentionCandidate,
  type WorkItemPreview,
  type WorkItemSummary,
} from '@/lib/azdoCommands';
import { fetchWorkItemImageCached } from '@/lib/workItemImageCache';
import { PreviewEmptyState } from '@/components/StateDisplay';
import {
  loadPreviewFieldKeys,
  storePreviewFieldKeys,
  type CustomPreviewField,
  type PreviewFieldKey,
} from './previewFieldsStorage';
import {
  buildDuplicateDraft,
  customPreviewFieldValue,
  type WorkItemDuplicateDraft,
} from './workItemChanges';
import { makeWorkItemPreviewKeyDown } from './workItemPreviewKeyDown';
import { WorkItemPreviewActions } from './WorkItemPreviewActions';
import {
  AssigneePicker,
  ClassificationPicker,
  CustomFieldPicker,
  PriorityPicker,
  ReasonEditor,
  StatePicker,
} from './PreviewEditors';
import { CommentComposer } from './CommentComposer';
import { WorkItemPreviewDetails } from './WorkItemPreviewDetails';
import { PresetMenu } from './PreviewPresetMenu';
import { StagedStatusChip } from './StagedStatusChip';
import { useWorkItemStagedChanges } from './useWorkItemStagedChanges';
import { useWorkItemPickerState } from './useWorkItemPickerState';

// Re-exported so existing importers (and the unit tests) keep a single entry
// point; the implementations live in the sibling modules linked below.
export { buildDuplicateDraft, presetFieldsFromStaged, splitWorkItemTags, stagedChangesFromPresetFields } from './workItemChanges';
export { splitMatchSegments } from './PreviewEditors';
export { workItemStateDotClass, workItemTypeColor } from './WorkItemPreviewDetails';
export {
  activeMentionAt,
  isSelfIdentity,
  markdownWithHardLineBreaks,
  mentionTokenDeletionStart,
  rankMentionCandidates,
  renderAzureMentionMarkdown,
  sortSelfLast,
} from './workItemMentions';

export function WorkItemPreviewPanel({
  customPreviewFields,
  focusCommentRequest,
  openAssigneeRequest,
  openFieldRequest,
  openPriorityRequest,
  openStateRequest,
  onCustomPreviewFieldsChange,
  onDuplicate,
  preview,
  previewError,
  previewLoading,
  selectedItem,
  onPreviewUpdated,
}: {
  customPreviewFields: CustomPreviewField[];
  focusCommentRequest?: number;
  openAssigneeRequest?: number;
  openFieldRequest?: number;
  openPriorityRequest?: number;
  openStateRequest?: number;
  onCustomPreviewFieldsChange: (fields: CustomPreviewField[]) => void;
  onDuplicate?: (draft: WorkItemDuplicateDraft) => void;
  preview: WorkItemPreview | null;
  previewError: string | null;
  previewLoading: boolean;
  selectedItem: WorkItemSummary | null;
  onPreviewUpdated?: (preview: WorkItemPreview) => void;
}) {
  const [selectedPreviewFieldKeys, setSelectedPreviewFieldKeys] = useState<PreviewFieldKey[]>(
    () => loadPreviewFieldKeys(),
  );
  const [mentionDisplayNamesById, setMentionDisplayNamesById] = useState<
    Record<string, string>
  >({});
  const panelRef = useRef<HTMLElement | null>(null);

  const customFieldsSignature = useMemo(
    () => customPreviewFields.map((field) => field.referenceName).join("|"),
    [customPreviewFields],
  );

  useEffect(() => {
    storePreviewFieldKeys(selectedPreviewFieldKeys);
  }, [selectedPreviewFieldKeys]);

  const {
    staged,
    setStagedChanges,
    stagedEntries,
    discardStaged,
    presets,
    applying,
    applyError,
    undoState,
    applyStaged,
    undoLastApply,
    applyTitle,
    applyClassification,
    applyPreset,
    savePresetFromStaged,
    deletePreset,
    deleteComment,
    editComment,
    toggleCommentReaction,
    deleteCommentError,
    deletingCommentId,
    deletePending,
    editCommentError,
    editingCommentId,
    editPending,
    reactionPendingCommentId,
    updateFieldsPending,
  } = useWorkItemStagedChanges({
    selectedItem,
    preview,
    customFieldsSignature,
    onPreviewUpdated,
    panelRef,
  });

  const {
    assigneeOpen,
    setAssigneeOpen,
    assigneeQuery,
    setAssigneeQuery,
    statePickerOpen,
    setStatePickerOpen,
    reasonEditorOpen,
    setReasonEditorOpen,
    priorityPickerOpen,
    setPriorityPickerOpen,
    areaPickerOpen,
    setAreaPickerOpen,
    iterationPickerOpen,
    setIterationPickerOpen,
    customFieldEditor,
    setCustomFieldEditor,
    statesQuery,
    classificationQuery,
    customFieldValuesQuery,
    selfOrg,
    assigneeOptions,
    assigneeDefaultLoading,
    assigneeOptionsLoading,
    assigneeDefaultError,
    assigneeOptionsError,
    recentMentionOptions,
    mentionPriorityNames,
    assignTo,
    setPriority,
    stageState,
    stageReason,
    stageTags,
    stageCustomField,
    openNextCustomField,
  } = useWorkItemPickerState({
    selectedItem,
    preview,
    customPreviewFields,
    setStagedChanges,
    openAssigneeRequest,
    openStateRequest,
    openPriorityRequest,
    openFieldRequest,
  });

  const commentMentionDisplayNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const [id, displayName] of Object.entries(mentionDisplayNamesById)) {
      names.set(id, displayName);
      names.set(id.toLowerCase(), displayName);
    }
    for (const candidate of recentMentionOptions) {
      names.set(candidate.id, candidate.displayName);
      names.set(candidate.id.toLowerCase(), candidate.displayName);
    }
    return names;
  }, [mentionDisplayNamesById, recentMentionOptions]);

  const resolvePreviewImage = useMemo(
    () => async (url: string) => {
      if (!selectedItem) return null;
      return fetchWorkItemImageCached({
        organizationId: selectedItem.organizationId,
        url,
      });
    },
    [selectedItem],
  );

  function handleMentionApplied(candidate: MentionCandidate) {
    setMentionDisplayNamesById((current) => ({
      ...current,
      [candidate.id]: candidate.displayName,
    }));
  }

  function duplicateSelected() {
    if (!onDuplicate || !preview) return;
    onDuplicate(buildDuplicateDraft(preview));
  }

  function focusPanelBody() {
    panelRef.current
      ?.querySelector<HTMLElement>("[data-primary-preview='true']")
      ?.focus();
  }

  const handlePreviewPanelKeyDown = makeWorkItemPreviewKeyDown({
    applyStaged,
    discardStaged,
    undoLastApply,
    undoState,
    stagedEntries,
    presets,
    applyPreset,
    statePickerOpen,
    assigneeOpen,
    reasonEditorOpen,
    priorityPickerOpen,
    customFieldEditor,
    setStatePickerOpen,
    setAssigneeOpen,
    setReasonEditorOpen,
    setPriorityPickerOpen,
    setAssigneeQuery,
    openNextCustomField,
    onDuplicate,
    preview,
    duplicateSelected,
  });

  return (
    <aside
      ref={panelRef}
      className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card shadow-sm transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/25"
      onKeyDown={handlePreviewPanelKeyDown}
    >
      {!selectedItem ? (
        <PreviewEmptyState message="Select a work item." />
      ) : (
        <>
          {previewError ? (
            <div className="m-3 rounded-md border border-destructive/30 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-destructive">
              {previewError}
            </div>
          ) : preview ? (
            <>
              <WorkItemPreviewDetails
                customPreviewFields={customPreviewFields}
                statusChip={
                  <StagedStatusChip
                    stagedEntries={stagedEntries}
                    applying={applying}
                    onApply={() => void applyStaged()}
                    onDiscard={discardStaged}
                    undoState={undoState}
                    onUndo={() => void undoLastApply()}
                    applyError={applyError}
                  />
                }
                actionsControl={
                  <WorkItemPreviewActions
                    preview={preview}
                    onDuplicate={onDuplicate ? duplicateSelected : null}
                  />
                }
                presetsControl={
                  <PresetMenu
                    canSave={stagedEntries.length > 0}
                    onApply={applyPreset}
                    onDelete={deletePreset}
                    onSave={savePresetFromStaged}
                    presets={presets}
                    stagedCount={stagedEntries.length}
                  />
                }
                deleteCommentError={deleteCommentError}
                deletingCommentId={deletingCommentId}
                deletePending={deletePending}
                editCommentError={editCommentError}
                editingCommentId={editingCommentId}
                editPending={editPending}
                mentionDisplayNames={commentMentionDisplayNames}
                recentMentionOptions={recentMentionOptions}
                mentionPriorityNames={mentionPriorityNames}
                selfOrg={selfOrg}
                onMentionApplied={handleMentionApplied}
                onCustomPreviewFieldsChange={onCustomPreviewFieldsChange}
                onDeleteComment={deleteComment}
                onEditComment={editComment}
                onToggleCommentReaction={toggleCommentReaction}
                reactionPendingCommentId={reactionPendingCommentId}
                preview={preview}
                selectedFieldKeys={selectedPreviewFieldKeys}
                onSelectedFieldKeysChange={setSelectedPreviewFieldKeys}
                tagsPending={applying}
                onTagsChange={stageTags}
                titlePending={updateFieldsPending}
                onTitleChange={applyTitle}
                reasonControl={
                  <ReasonEditor
                    current={staged.reason ?? preview.reason}
                    error={null}
                    onOpenChange={(open) => {
                      setReasonEditorOpen(open);
                      if (open) {
                        setAssigneeOpen(false);
                        setPriorityPickerOpen(false);
                        setStatePickerOpen(false);
                      }
                    }}
                    onSubmit={stageReason}
                    open={reasonEditorOpen}
                    pending={applying}
                    shortcut="R"
                  />
                }
                priorityControl={
                  <PriorityPicker
                    current={
                      staged.priority !== undefined ? String(staged.priority) : preview.priority
                    }
                    error={null}
                    onOpenChange={(open) => {
                      setPriorityPickerOpen(open);
                      if (open) {
                        setAssigneeOpen(false);
                        setStatePickerOpen(false);
                      }
                    }}
                    onSelect={setPriority}
                    open={priorityPickerOpen}
                    pending={applying}
                    shortcut="P"
                  />
                }
                renderCustomFieldControl={(field) => (
                  <CustomFieldPicker
                    label={field.label}
                    shortcut="F"
                    current={
                      staged.fields?.[field.referenceName]?.value ??
                      customPreviewFieldValue(preview, field.referenceName)
                    }
                    error={null}
                    loading={customFieldValuesQuery.isLoading}
                    onOpenChange={(open) => {
                      setCustomFieldEditor(open ? field.referenceName : null);
                    }}
                    onSelect={(value) =>
                      stageCustomField(field.referenceName, field.label, value)
                    }
                    open={customFieldEditor === field.referenceName}
                    options={
                      customFieldEditor === field.referenceName
                        ? (customFieldValuesQuery.data as string[] ?? [])
                        : []
                    }
                    pending={applying && customFieldEditor === field.referenceName}
                  />
                )}
                resolveImageSource={resolvePreviewImage}
                stateControl={
                  <StatePicker
                    current={staged.state ?? preview.state}
                    error={null}
                    loading={statesQuery.isFetching}
                    onOpenChange={(open) => {
                      setStatePickerOpen(open);
                      if (open) {
                        setAssigneeOpen(false);
                        setPriorityPickerOpen(false);
                      }
                    }}
                    onSelect={(state) => {
                      setPriorityPickerOpen(false);
                      stageState(state);
                    }}
                    open={statePickerOpen}
                    options={statesQuery.data as string[] ?? []}
                    pending={applying}
                    shortcut="S"
                  />
                }
                assigneeControl={
                  <AssigneePicker
                    current={staged.assignee?.displayName ?? preview.assignedTo}
                    error={
                      assigneeQuery.trim()
                        ? assigneeOptionsError
                        : assigneeDefaultError
                    }
                    mutationError={null}
                    loading={assigneeDefaultLoading || assigneeOptionsLoading}
                    onOpenChange={(open) => {
                      setAssigneeOpen(open);
                      if (open) setPriorityPickerOpen(false);
                    }}
                    onQueryChange={setAssigneeQuery}
                    onSelect={assignTo}
                    open={assigneeOpen}
                    options={assigneeOptions}
                    pending={applying}
                    query={assigneeQuery}
                    shortcut="A"
                  />
                }
                areaControl={
                  <ClassificationPicker
                    ariaLabel="Change area path"
                    current={preview.areaPath}
                    emptyLabel="No areas available"
                    error={
                      areaPickerOpen && classificationQuery.isError
                        ? commandErrorMessage(classificationQuery.error)
                        : null
                    }
                    loading={classificationQuery.isFetching}
                    onOpenChange={(open) => {
                      setAreaPickerOpen(open);
                      if (open) setIterationPickerOpen(false);
                    }}
                    onSelect={(path) => applyClassification("System.AreaPath", path)}
                    open={areaPickerOpen}
                    options={classificationQuery.data?.areas ?? []}
                    pending={applying || updateFieldsPending}
                  />
                }
                iterationControl={
                  <ClassificationPicker
                    ariaLabel="Change iteration path"
                    current={preview.iterationPath}
                    emptyLabel="No iterations available"
                    error={
                      iterationPickerOpen && classificationQuery.isError
                        ? commandErrorMessage(classificationQuery.error)
                        : null
                    }
                    loading={classificationQuery.isFetching}
                    onOpenChange={(open) => {
                      setIterationPickerOpen(open);
                      if (open) setAreaPickerOpen(false);
                    }}
                    onSelect={(path) => applyClassification("System.IterationPath", path)}
                    open={iterationPickerOpen}
                    options={classificationQuery.data?.iterations ?? []}
                    pending={applying || updateFieldsPending}
                  />
                }
              />
              <CommentComposer
                focusCommentRequest={focusCommentRequest}
                hasStagedChanges={stagedEntries.length > 0}
                mentionPriorityNames={mentionPriorityNames}
                onApplyStaged={() => { void applyStaged(); }}
                onEscapeToPanel={focusPanelBody}
                onMentionApplied={handleMentionApplied}
                recentMentionOptions={recentMentionOptions}
                selectedItem={selectedItem}
                selfOrg={selfOrg}
              />
            </>
          ) : previewLoading ? (
            <PreviewEmptyState message={`Loading work item #${selectedItem.id}.`} />
          ) : (
            <PreviewEmptyState message={`Work item #${selectedItem.id} is not available.`} />
          )}
        </>
      )}
    </aside>
  );
}
