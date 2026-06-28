import {
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  commandErrorMessage,
  deleteWorkItemComment,
  recordAssigneeInteraction,
  setWorkItemCommentReaction,
  updateWorkItemComment,
  updateWorkItemFields,
  type WorkItemFieldValueInput,
  type WorkItemPreview,
  type WorkItemSummary,
} from '@/lib/azdoCommands';
import { invalidateWorkItemQueryViews, workItemQueryKeys } from './queryKeys';
import {
  loadFieldPresets,
  storeFieldPresets,
  MAX_FIELD_PRESETS,
  type WorkItemFieldPreset,
} from './fieldPresetsStorage';
import {
  buildInverseChanges,
  presetFieldsFromStaged,
  stagedChangesFromPresetFields,
  stagedEntriesForPreview,
  type StagedChanges,
} from './workItemChanges';

const UNDO_WINDOW_MS = 10_000;

export function useWorkItemStagedChanges({
  selectedItem,
  preview,
  customFieldsSignature,
  onPreviewUpdated,
  panelRef,
}: {
  selectedItem: WorkItemSummary | null;
  preview: WorkItemPreview | null;
  customFieldsSignature: string;
  onPreviewUpdated: ((preview: WorkItemPreview) => void) | undefined;
  panelRef: React.RefObject<HTMLElement | null>;
}) {
  const queryClient = useQueryClient();

  const [staged, setStaged] = useState<StagedChanges>({});
  const [presets, setPresets] = useState<WorkItemFieldPreset[]>(() => loadFieldPresets());
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [undoState, setUndoState] = useState<{
    changes: StagedChanges;
    workItemId: number;
    count: number;
  } | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const stagedRef = useRef<StagedChanges>(staged);
  const previewRef = useRef<WorkItemPreview | null>(preview ?? null);
  stagedRef.current = staged;
  previewRef.current = preview ?? null;

  function setStagedChanges(action: SetStateAction<StagedChanges>) {
    setStaged((current) => {
      const next = typeof action === "function" ? action(current) : action;
      stagedRef.current = next;
      return next;
    });
  }

  const stagedEntries = useMemo(() => stagedEntriesForPreview(preview, staged), [preview, staged]);

  function discardStaged() {
    setStagedChanges({});
    setApplyError(null);
  }

  function applyPreset(preset: WorkItemFieldPreset) {
    if (!selectedItem) return;
    const changes = stagedChangesFromPresetFields(preset.fields, preview);
    setStagedChanges((current) => ({
      ...current,
      ...changes,
      fields:
        changes.fields || current.fields
          ? { ...current.fields, ...changes.fields }
          : undefined,
    }));
  }

  function savePresetFromStaged(name: string) {
    const fields = presetFieldsFromStaged(stagedRef.current);
    if (fields.length === 0) return;
    const preset: WorkItemFieldPreset = {
      id: `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      fields,
    };
    setPresets((current) => {
      const next = [...current, preset].slice(0, MAX_FIELD_PRESETS);
      storeFieldPresets(next);
      return next;
    });
  }

  function deletePreset(id: string) {
    setPresets((current) => {
      const next = current.filter((preset) => preset.id !== id);
      storeFieldPresets(next);
      return next;
    });
  }

  const deleteCommentMutation = useMutation({
    mutationFn: deleteWorkItemComment,
    onSuccess: (_result, variables) => {
      queryClient.setQueryData(
        workItemQueryKeys.preview(
          variables.organizationId,
          variables.projectId,
          variables.workItemId,
          customFieldsSignature,
        ),
        (current: WorkItemPreview | undefined) =>
          current
            ? {
                ...current,
                comments: current.comments.filter(
                  (comment) => comment.id !== variables.commentId,
                ),
              }
            : current,
      );
      void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.previewRoot() });
    },
  });

  const editCommentMutation = useMutation({
    mutationFn: updateWorkItemComment,
    onSuccess: (updated, variables) => {
      queryClient.setQueryData(
        workItemQueryKeys.preview(
          variables.organizationId,
          variables.projectId,
          variables.workItemId,
          customFieldsSignature,
        ),
        (current: WorkItemPreview | undefined) =>
          current
            ? {
                ...current,
                comments: current.comments.map((comment) =>
                  comment.id === variables.commentId
                    ? { ...comment, text: updated.text, renderedText: updated.renderedText }
                    : comment,
                ),
              }
            : current,
      );
      void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.previewRoot() });
    },
  });

  const reactionMutation = useMutation({
    mutationFn: setWorkItemCommentReaction,
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({
        queryKey: workItemQueryKeys.preview(
          variables.organizationId,
          variables.projectId,
          variables.workItemId,
          customFieldsSignature,
        ),
      });
    },
  });
  const reactionPendingCommentId = reactionMutation.isPending
    ? (reactionMutation.variables?.commentId ?? null)
    : null;

  const updateFieldsMutation = useMutation({
    mutationFn: updateWorkItemFields,
    onSuccess: (updatedPreview) => {
      onPreviewUpdated?.(updatedPreview);
      queryClient.setQueryData(
        workItemQueryKeys.preview(
          updatedPreview.organizationId,
          updatedPreview.projectId,
          updatedPreview.id,
          customFieldsSignature,
        ),
        (current: WorkItemPreview | undefined) =>
          current
            ? { ...updatedPreview, relations: current.relations }
            : updatedPreview,
      );
      void queryClient.invalidateQueries({
        queryKey: workItemQueryKeys.previewRoot(),
        refetchType: "none",
      });
      void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.myItemsRoot() });
      invalidateWorkItemQueryViews(queryClient);
    },
  });

  function toggleCommentReaction(commentId: number, reactionType: string, engaged: boolean) {
    if (!selectedItem) return;
    reactionMutation.mutate({
      organizationId: selectedItem.organizationId,
      projectId: selectedItem.projectId,
      workItemId: selectedItem.id,
      commentId,
      reactionType:
        reactionType as Parameters<typeof setWorkItemCommentReaction>[0]["reactionType"],
      engaged,
    });
  }

  function deleteComment(commentId: number) {
    if (!selectedItem || deleteCommentMutation.isPending) return;
    deleteCommentMutation.mutate({
      organizationId: selectedItem.organizationId,
      projectId: selectedItem.projectId,
      workItemId: selectedItem.id,
      commentId,
    });
  }

  function editComment(commentId: number, markdown: string) {
    if (!selectedItem || editCommentMutation.isPending) return;
    editCommentMutation.mutate({
      organizationId: selectedItem.organizationId,
      projectId: selectedItem.projectId,
      workItemId: selectedItem.id,
      commentId,
      markdown,
    });
  }

  async function applyChangeSet(changes: StagedChanges) {
    if (!selectedItem) return;
    const fields: WorkItemFieldValueInput[] = [];
    if (changes.assignee) {
      fields.push({ referenceName: "System.AssignedTo", value: changes.assignee.assignValue });
    }
    if (changes.priority !== undefined) {
      fields.push({
        referenceName: "Microsoft.VSTS.Common.Priority",
        value: String(changes.priority),
      });
    }
    if (changes.tags) {
      fields.push({ referenceName: "System.Tags", value: changes.tags.join("; ") });
    }
    for (const [referenceName, field] of Object.entries(changes.fields ?? {})) {
      fields.push({ referenceName, value: field.value });
    }
    if (changes.state !== undefined) {
      fields.push({ referenceName: "System.State", value: changes.state });
    }
    if (changes.reason !== undefined) {
      fields.push({ referenceName: "System.Reason", value: changes.reason });
    }
    if (fields.length === 0) return;
    await updateFieldsMutation.mutateAsync({
      organizationId: selectedItem.organizationId,
      projectId: selectedItem.projectId,
      workItemId: selectedItem.id,
      fields,
    });
  }

  function applyTitle(title: string) {
    if (!selectedItem) return;
    updateFieldsMutation.mutate({
      organizationId: selectedItem.organizationId,
      projectId: selectedItem.projectId,
      workItemId: selectedItem.id,
      fields: [{ referenceName: "System.Title", value: title }],
    });
  }

  function applyClassification(referenceName: string, path: string) {
    if (!selectedItem) return;
    updateFieldsMutation.mutate({
      organizationId: selectedItem.organizationId,
      projectId: selectedItem.projectId,
      workItemId: selectedItem.id,
      fields: [{ referenceName, value: path }],
    });
  }

  function restorePanelFocus(previousFocus: Element | null) {
    window.setTimeout(() => {
      const panel = panelRef.current;
      const active = document.activeElement;
      if (!panel || (active && active !== document.body)) return;
      if (previousFocus instanceof HTMLElement && panel.contains(previousFocus)) {
        previousFocus.focus();
      } else {
        panel.querySelector<HTMLElement>("[data-primary-preview='true']")?.focus();
      }
    }, 0);
  }

  async function applyStaged() {
    const currentStaged = stagedRef.current;
    const currentPreview = previewRef.current;
    const currentStagedEntries = stagedEntriesForPreview(currentPreview, currentStaged);
    if (!selectedItem || applying || currentStagedEntries.length === 0) return;
    const previousFocus = document.activeElement;
    const inverse = currentPreview ? buildInverseChanges(currentPreview, currentStaged) : {};
    const appliedCount = currentStagedEntries.length;
    const workItemId = selectedItem.id;
    setApplying(true);
    setApplyError(null);
    try {
      await applyChangeSet(currentStaged);
      if (currentStaged.assignee?.uniqueName) {
        void recordAssigneeInteraction({
          organizationId: selectedItem.organizationId,
          userId: currentStaged.assignee.id,
          displayName: currentStaged.assignee.displayName,
          uniqueName: currentStaged.assignee.uniqueName,
        }).catch(() => {
          // History is best-effort; the assignment itself already succeeded.
        });
      }
      setStagedChanges({});
      setUndoState({ changes: inverse, workItemId, count: appliedCount });
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = window.setTimeout(() => {
        setUndoState(null);
        undoTimerRef.current = null;
      }, UNDO_WINDOW_MS);
    } catch (error) {
      setApplyError(commandErrorMessage(error));
    } finally {
      setApplying(false);
      restorePanelFocus(previousFocus);
    }
  }

  async function undoLastApply() {
    const undo = undoState;
    if (!undo || !selectedItem || applying || selectedItem.id !== undo.workItemId) return;
    const previousFocus = document.activeElement;
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndoState(null);
    setApplying(true);
    setApplyError(null);
    try {
      await applyChangeSet(undo.changes);
    } catch (error) {
      setApplyError(commandErrorMessage(error));
      if (selectedItem.id === undo.workItemId) setUndoState(undo);
    } finally {
      setApplying(false);
      restorePanelFocus(previousFocus);
    }
  }

  useEffect(() => {
    setStagedChanges({});
    setApplyError(null);
    setUndoState(null);
    updateFieldsMutation.reset();
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem?.id]);

  const applyStagedRef = useRef<() => void>(() => {});
  applyStagedRef.current = () => { void applyStaged(); };
  const undoApplyRef = useRef<() => void>(() => {});
  undoApplyRef.current = () => { void undoLastApply(); };

  useEffect(() => {
    function applyStagedFromCommand() { applyStagedRef.current(); }
    function undoApplyFromCommand() { undoApplyRef.current(); }
    window.addEventListener("azdodeck:work-items:apply-staged", applyStagedFromCommand);
    window.addEventListener("azdodeck:work-items:undo-apply", undoApplyFromCommand);
    return () => {
      window.removeEventListener("azdodeck:work-items:apply-staged", applyStagedFromCommand);
      window.removeEventListener("azdodeck:work-items:undo-apply", undoApplyFromCommand);
    };
  }, []);

  return {
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
    deleteCommentError: deleteCommentMutation.isError
      ? commandErrorMessage(deleteCommentMutation.error)
      : null,
    deletingCommentId: deleteCommentMutation.isPending
      ? (deleteCommentMutation.variables?.commentId ?? null)
      : null,
    deletePending: deleteCommentMutation.isPending,
    editCommentError: editCommentMutation.isError
      ? commandErrorMessage(editCommentMutation.error)
      : null,
    editingCommentId: editCommentMutation.isPending
      ? (editCommentMutation.variables?.commentId ?? null)
      : null,
    editPending: editCommentMutation.isPending,
    reactionPendingCommentId,
    updateFieldsPending: updateFieldsMutation.isPending,
  };
}
