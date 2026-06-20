import {
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, Trash2, X, Zap } from 'lucide-react';
import {
  deleteWorkItemComment,
  updateWorkItemComment,
  listOrganizations,
  listWorkItemTypeStates,
  listWorkItemFieldAllowedValues,
  searchWorkItemAssignees,
  recordAssigneeInteraction,
  updateWorkItemFields,
  commandErrorMessage,
  type MentionCandidate,
  type WorkItemAssigneeCandidate,
  type WorkItemFieldValueInput,
  type WorkItemPreview,
  type WorkItemSummary,
} from '@/lib/azdoCommands';
import {
  focusPrimaryGrid,
  focusWorkItemCommentInput,
  isEditableTarget,
} from '@/lib/utils';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { fetchWorkItemImageCached } from '@/lib/workItemImageCache';
import { PreviewEmptyState } from '@/components/StateDisplay';
import { ShortcutHint } from '@/components/ShortcutHint';
import { invalidateWorkItemQueryViews, workItemQueryKeys } from './queryKeys';
import {
  loadPreviewFieldKeys,
  storePreviewFieldKeys,
  type CustomPreviewField,
  type PreviewFieldKey,
} from './previewFieldsStorage';
import {
  loadFieldPresets,
  storeFieldPresets,
  MAX_FIELD_PRESETS,
  type WorkItemFieldPreset,
} from './fieldPresetsStorage';
import {
  buildDuplicateDraft,
  buildInverseChanges,
  customPreviewFieldValue,
  presetFieldsFromStaged,
  splitWorkItemTags,
  stagedChangesFromPresetFields,
  stagedEntriesForPreview,
  type StagedChanges,
  type WorkItemDuplicateDraft,
} from './workItemChanges';

import {
  rankMentionCandidates,
  recentWorkItemAssigneeCandidates,
  recentWorkItemMentionCandidates,
  sortSelfLast,
  workItemMentionPriorityNames,
} from './workItemMentions';
import {
  AssigneePicker,
  CustomFieldPicker,
  PriorityPicker,
  ReasonEditor,
  StatePicker,
  useCloseOnOutsidePointer,
} from './PreviewEditors';
import { CommentComposer } from './CommentComposer';
import { WorkItemPreviewDetails } from './WorkItemPreviewDetails';

// Re-exported so existing importers (and the unit tests) keep a single entry
// point; the implementations live in the sibling modules linked below.
export { buildDuplicateDraft, presetFieldsFromStaged, splitWorkItemTags, stagedChangesFromPresetFields };
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

const UNDO_WINDOW_MS = 10_000;
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
  // Opens the create form pre-filled with the current item's fields. Absent
  // until the work item create UI (B-1) exists; while unset the Duplicate
  // action and its `D` shortcut stay hidden, per the feature's gating.
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
  const queryClient = useQueryClient();
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [statePickerOpen, setStatePickerOpen] = useState(false);
  const [reasonEditorOpen, setReasonEditorOpen] = useState(false);
  const [priorityPickerOpen, setPriorityPickerOpen] = useState(false);
  const [customFieldEditor, setCustomFieldEditor] = useState<string | null>(null);
  const handledOpenAssigneeRequest = useRef(0);
  const handledOpenFieldRequest = useRef(0);
  const handledOpenPriorityRequest = useRef(0);
  const handledOpenStateRequest = useRef(0);

  const statesQuery = useQuery({
    queryKey: workItemQueryKeys.typeStates(
      selectedItem?.organizationId,
      selectedItem?.projectId,
      preview?.workItemType,
    ),
    queryFn: () =>
      listWorkItemTypeStates({
        organizationId: selectedItem?.organizationId,
        projectId: selectedItem?.projectId ?? "",
        workItemType: preview?.workItemType ?? "",
      }),
    enabled: statePickerOpen && !!preview?.workItemType,
    staleTime: Infinity,
  });
  const customFieldValuesQuery = useQuery({
    queryKey: workItemQueryKeys.fieldAllowedValues(
      selectedItem?.organizationId,
      selectedItem?.projectId,
      preview?.workItemType,
      customFieldEditor,
    ),
    queryFn: () =>
      listWorkItemFieldAllowedValues({
        organizationId: selectedItem?.organizationId,
        projectId: selectedItem?.projectId ?? "",
        workItemType: preview?.workItemType ?? "",
        fieldReferenceName: customFieldEditor ?? "",
      }),
    enabled: customFieldEditor !== null && !!selectedItem && !!preview?.workItemType,
    staleTime: Infinity,
  });
  const organizationsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: listOrganizations,
    staleTime: 5 * 60_000,
  });
  const selfOrg = useMemo(
    () => organizationsQuery.data?.find((org) => org.id === selectedItem?.organizationId),
    [organizationsQuery.data, selectedItem?.organizationId],
  );
  const recentMentionOptions = useMemo(
    () => recentWorkItemMentionCandidates(preview),
    [preview],
  );
  const recentAssigneeOptions = useMemo(
    () => recentWorkItemAssigneeCandidates(preview),
    [preview],
  );
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
  const mentionPriorityNames = useMemo(
    () => workItemMentionPriorityNames(preview),
    [preview],
  );

  useEffect(() => {
    storePreviewFieldKeys(selectedPreviewFieldKeys);
  }, [selectedPreviewFieldKeys]);

  // Load default candidates as soon as the picker opens.
  const assigneeDefaultQuery = useQuery({
    queryKey: workItemQueryKeys.assignees(
      selectedItem?.organizationId,
      selectedItem?.projectId,
      selectedItem?.id,
      "",
    ),
    queryFn: () =>
      searchWorkItemAssignees({
        organizationId: selectedItem!.organizationId,
        projectId: selectedItem!.projectId,
        workItemId: selectedItem!.id,
        query: "",
      }),
    enabled: !!selectedItem && assigneeOpen,
    staleTime: 60_000,
  });
  // Run typed search only when there is input; the default query covers the empty state.
  const debouncedAssigneeQuery = useDebouncedValue(assigneeQuery, 200);
  const assigneeOptionsQuery = useQuery({
    queryKey: workItemQueryKeys.assignees(
      selectedItem?.organizationId,
      selectedItem?.projectId,
      selectedItem?.id,
      debouncedAssigneeQuery,
    ),
    queryFn: () =>
      searchWorkItemAssignees({
        organizationId: selectedItem!.organizationId,
        projectId: selectedItem!.projectId,
        workItemId: selectedItem!.id,
        query: debouncedAssigneeQuery,
      }),
    enabled: !!selectedItem && assigneeOpen && debouncedAssigneeQuery.trim().length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const assigneeOptions = useMemo(
    () =>
      sortSelfLast(
        rankMentionCandidates({
          recent: [...recentAssigneeOptions, ...(assigneeDefaultQuery.data ?? [])],
          remote: assigneeOptionsQuery.data ?? [],
          query: assigneeQuery,
          priorityNames: mentionPriorityNames,
        }),
        selfOrg,
      ),
    [
      assigneeDefaultQuery.data,
      assigneeOptionsQuery.data,
      assigneeQuery,
      mentionPriorityNames,
      recentAssigneeOptions,
      selfOrg,
    ],
  );

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

  const deleteCommentMutation = useMutation({
    mutationFn: deleteWorkItemComment,
    onSuccess: (_result, variables) => {
      queryClient.setQueryData(
        workItemQueryKeys.preview(
          variables.organizationId,
          variables.projectId,
          variables.workItemId,
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

  // Must match how the grids build their preview query key.
  const customFieldsSignature = useMemo(
    () => customPreviewFields.map((field) => field.referenceName).join("|"),
    [customPreviewFields],
  );
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
        // The mutation response carries no relations; keep the cached ones
        // instead of blanking the Related section until the next refetch.
        (current: WorkItemPreview | undefined) =>
          current
            ? { ...updatedPreview, relations: current.relations }
            : updatedPreview,
      );
      // The response above is already the fresh preview; mark the other
      // cached previews stale without refetching the one just written.
      void queryClient.invalidateQueries({
        queryKey: workItemQueryKeys.previewRoot(),
        refetchType: "none",
      });
      void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.myItemsRoot() });
      invalidateWorkItemQueryViews(queryClient);
    },
  });
  // Property edits are staged locally and written to Azure DevOps only on an
  // explicit apply (Ctrl+S); Esc discards.
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

  // Stages a preset's field changes; the user still reviews and applies them
  // with Ctrl+S like any other pending change.
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

  // All staged values go out as one JSON Patch, so the apply is atomic: state
  // transition rules see the whole change set, and a failure leaves everything
  // staged.
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

  // Applying disables the focused picker trigger (and unmounts the chip button
  // that was clicked), so keyboard focus silently falls to <body>. Restore it
  // after the post-apply rerender has re-enabled the controls.
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
      // The undo write failed, so the apply still stands. Restore the undo
      // affordance (same item only) so the user can retry.
      if (selectedItem.id === undo.workItemId) setUndoState(undo);
    } finally {
      setApplying(false);
      restorePanelFocus(previousFocus);
    }
  }

  useEffect(() => {
    setAssigneeOpen(false);
    setAssigneeQuery("");
    setStatePickerOpen(false);
    setReasonEditorOpen(false);
    setPriorityPickerOpen(false);
    setCustomFieldEditor(null);
    updateFieldsMutation.reset();
    setStagedChanges({});
    setApplyError(null);
    setUndoState(null);
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }, [selectedItem?.id]);

  useEffect(() => {
    if (
      !openAssigneeRequest ||
      handledOpenAssigneeRequest.current === openAssigneeRequest
    ) {
      return;
    }
    handledOpenAssigneeRequest.current = openAssigneeRequest;
    if (!selectedItem) return;
    setAssigneeOpen(true);
    setStatePickerOpen(false);
    setReasonEditorOpen(false);
    setPriorityPickerOpen(false);
    setAssigneeQuery("");
  }, [openAssigneeRequest, selectedItem]);

  useEffect(() => {
    if (
      !openStateRequest ||
      handledOpenStateRequest.current === openStateRequest
    ) {
      return;
    }
    handledOpenStateRequest.current = openStateRequest;
    if (!selectedItem) return;
    setStatePickerOpen(true);
    setAssigneeOpen(false);
    setReasonEditorOpen(false);
    setPriorityPickerOpen(false);
  }, [openStateRequest, selectedItem]);

  useEffect(() => {
    if (
      !openPriorityRequest ||
      handledOpenPriorityRequest.current === openPriorityRequest
    ) {
      return;
    }
    handledOpenPriorityRequest.current = openPriorityRequest;
    if (!selectedItem) return;
    setPriorityPickerOpen(true);
    setAssigneeOpen(false);
    setReasonEditorOpen(false);
    setStatePickerOpen(false);
  }, [openPriorityRequest, selectedItem]);

  function handleMentionApplied(candidate: MentionCandidate) {
    setMentionDisplayNamesById((current) => ({
      ...current,
      [candidate.id]: candidate.displayName,
    }));
  }

  // Opens the create form seeded from the current item. The draft is built from
  // the preview alone, so the source work item is never touched.
  function duplicateSelected() {
    if (!onDuplicate || !preview) return;
    onDuplicate(buildDuplicateDraft(preview));
  }

  function focusPanelBody() {
    panelRef.current
      ?.querySelector<HTMLElement>("[data-primary-preview='true']")
      ?.focus();
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

  function assignTo(candidate: WorkItemAssigneeCandidate) {
    if (!selectedItem) return;
    setStagedChanges((current) => ({
      ...current,
      assignee:
        candidate.displayName === preview?.assignedTo
          ? undefined
          : {
              assignValue: candidate.assignValue,
              displayName: candidate.displayName,
              id: candidate.id,
              uniqueName: candidate.uniqueName,
            },
    }));
    setAssigneeOpen(false);
    setAssigneeQuery("");
  }

  function setPriority(priority: number) {
    if (!selectedItem) return;
    setStagedChanges((current) => ({
      ...current,
      priority: String(priority) === preview?.priority ? undefined : priority,
    }));
    setPriorityPickerOpen(false);
  }

  function stageState(state: string) {
    if (!selectedItem) return;
    // Reason options belong to the current state, so a staged reason is
    // dropped when the state itself changes.
    setStagedChanges((current) => ({
      ...current,
      state: state === preview?.state ? undefined : state,
      reason: undefined,
    }));
    setStatePickerOpen(false);
  }

  function stageReason(reason: string) {
    if (!selectedItem) return;
    setStagedChanges((current) => ({
      ...current,
      reason: reason === preview?.reason ? undefined : reason,
    }));
    setReasonEditorOpen(false);
  }

  function stageTags(tags: string[]) {
    if (!selectedItem) return;
    const normalized = tags.join("; ");
    const currentTags = preview?.tags ?? "";
    setStagedChanges((current) => ({
      ...current,
      tags: normalized === currentTags ? undefined : tags,
    }));
  }

  function stageCustomField(referenceName: string, label: string, value: string) {
    if (!selectedItem) return;
    setStagedChanges((current) => {
      const fields = { ...current.fields };
      if (preview && (customPreviewFieldValue(preview, referenceName) ?? "") === value) {
        delete fields[referenceName];
      } else {
        fields[referenceName] = { label, value };
      }
      return { ...current, fields: Object.keys(fields).length > 0 ? fields : undefined };
    });
    setCustomFieldEditor(null);
  }

  // F opens the first custom field's picker; pressing F again moves to the
  // next one, wrapping, so every custom field stays reachable from the keyboard.
  function openNextCustomField() {
    if (!selectedItem || customPreviewFields.length === 0) return;
    const currentIndex = customPreviewFields.findIndex(
      (field) => field.referenceName === customFieldEditor,
    );
    const next = customPreviewFields[(currentIndex + 1) % customPreviewFields.length];
    setAssigneeOpen(false);
    setStatePickerOpen(false);
    setReasonEditorOpen(false);
    setPriorityPickerOpen(false);
    setCustomFieldEditor(next.referenceName);
  }
  const openNextCustomFieldRef = useRef<() => void>(() => {});
  openNextCustomFieldRef.current = openNextCustomField;

  useEffect(() => {
    if (!openFieldRequest || handledOpenFieldRequest.current === openFieldRequest) {
      return;
    }
    handledOpenFieldRequest.current = openFieldRequest;
    openNextCustomFieldRef.current();
  }, [openFieldRequest]);

  useEffect(() => {
    function openState() {
      if (!selectedItem) return;
      setStatePickerOpen(true);
      setAssigneeOpen(false);
      setReasonEditorOpen(false);
      setPriorityPickerOpen(false);
    }
    function openAssignee() {
      if (!selectedItem) return;
      setAssigneeOpen(true);
      setStatePickerOpen(false);
      setReasonEditorOpen(false);
      setPriorityPickerOpen(false);
      setAssigneeQuery("");
    }
    function openPriority() {
      if (!selectedItem) return;
      setPriorityPickerOpen(true);
      setAssigneeOpen(false);
      setReasonEditorOpen(false);
      setStatePickerOpen(false);
    }
    function openField() {
      openNextCustomFieldRef.current();
    }
    window.addEventListener("azdodeck:work-items:open-state", openState);
    window.addEventListener("azdodeck:work-items:open-assignee", openAssignee);
    window.addEventListener("azdodeck:work-items:open-priority", openPriority);
    window.addEventListener("azdodeck:work-items:open-field", openField);
    return () => {
      window.removeEventListener("azdodeck:work-items:open-state", openState);
      window.removeEventListener("azdodeck:work-items:open-assignee", openAssignee);
      window.removeEventListener("azdodeck:work-items:open-priority", openPriority);
      window.removeEventListener("azdodeck:work-items:open-field", openField);
    };
  }, [selectedItem]);

  const applyStagedRef = useRef<() => void>(() => {});
  applyStagedRef.current = () => {
    void applyStaged();
  };
  const undoApplyRef = useRef<() => void>(() => {});
  undoApplyRef.current = () => {
    void undoLastApply();
  };

  useEffect(() => {
    function applyStagedFromCommand() {
      applyStagedRef.current();
    }
    function undoApplyFromCommand() {
      undoApplyRef.current();
    }
    window.addEventListener("azdodeck:work-items:apply-staged", applyStagedFromCommand);
    window.addEventListener("azdodeck:work-items:undo-apply", undoApplyFromCommand);
    return () => {
      window.removeEventListener("azdodeck:work-items:apply-staged", applyStagedFromCommand);
      window.removeEventListener("azdodeck:work-items:undo-apply", undoApplyFromCommand);
    };
  }, []);

  function handlePreviewPanelKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      (event.key === "s" || event.key === "S")
    ) {
      event.preventDefault();
      event.stopPropagation();
      void applyStaged();
      return;
    }

    if (
      isEditableTarget(event.target) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }

    if (
      event.key === "Escape" &&
      !statePickerOpen &&
      !assigneeOpen &&
      !reasonEditorOpen &&
      !priorityPickerOpen &&
      !customFieldEditor
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (stagedEntries.length > 0) {
        // First Esc discards pending changes, the next one leaves the panel.
        discardStaged();
      } else {
        focusPrimaryGrid();
      }
      return;
    }

    if (event.key === "s" || event.key === "S") {
      event.preventDefault();
      setStatePickerOpen(true);
      setAssigneeOpen(false);
      setReasonEditorOpen(false);
      setPriorityPickerOpen(false);
    } else if (event.key === "a" || event.key === "A") {
      event.preventDefault();
      setAssigneeOpen(true);
      setStatePickerOpen(false);
      setReasonEditorOpen(false);
      setPriorityPickerOpen(false);
      setAssigneeQuery("");
    } else if (event.key === "p" || event.key === "P") {
      event.preventDefault();
      setPriorityPickerOpen(true);
      setAssigneeOpen(false);
      setReasonEditorOpen(false);
      setStatePickerOpen(false);
    } else if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      setReasonEditorOpen(true);
      setAssigneeOpen(false);
      setStatePickerOpen(false);
      setPriorityPickerOpen(false);
    } else if (event.key === "f" || event.key === "F") {
      event.preventDefault();
      openNextCustomField();
    } else if ((event.key === "d" || event.key === "D") && onDuplicate && preview) {
      event.preventDefault();
      duplicateSelected();
    } else if (event.key === "m" || event.key === "M") {
      event.preventDefault();
      focusWorkItemCommentInput();
    } else if (event.key === "u" || event.key === "U") {
      if (undoState) {
        event.preventDefault();
        void undoLastApply();
      }
    } else if (event.key >= "1" && event.key <= "9") {
      const preset = presets[Number(event.key) - 1];
      if (preset) {
        event.preventDefault();
        applyPreset(preset);
      }
    }
  }

  // Rendered inline in the preview header row, so it never overlaps content.
  const stagedStatusChip = (
    <>
      {stagedEntries.length > 0 ? (
        <span
          className="flex shrink-0 items-center gap-1 rounded-full border border-amber-300 bg-amber-50 py-0.5 pl-2 pr-0.5 text-[11px] dark:border-amber-800 dark:bg-amber-950/50"
          title={stagedEntries
            .map((entry) => `${entry.label}: ${entry.from} → ${entry.to}`)
            .join("\n")}
        >
          <span className="font-medium text-amber-900 dark:text-amber-200">{stagedEntries.length} pending</span>
          <button
            type="button"
            onClick={() => void applyStaged()}
            disabled={applying}
            title="Apply (Ctrl+S)"
            className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
            Apply
          </button>
          <button
            type="button"
            aria-label="Discard pending changes"
            title="Discard (Esc)"
            onClick={discardStaged}
            disabled={applying}
            className="rounded-full p-0.5 text-amber-900/70 hover:bg-amber-100 hover:text-amber-900 disabled:opacity-50 dark:text-amber-200/70 dark:hover:bg-amber-900 dark:hover:text-amber-100"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </span>
      ) : null}
      {undoState && stagedEntries.length === 0 ? (
        <span className="flex shrink-0 items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 py-0.5 pl-2 pr-0.5 text-[11px] dark:border-emerald-800 dark:bg-emerald-950/50">
          <span className="text-emerald-900 dark:text-emerald-200">Applied {undoState.count}</span>
          <button
            type="button"
            onClick={() => void undoLastApply()}
            disabled={applying}
            title="Undo (U)"
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 hover:bg-secondary disabled:opacity-50"
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
            Undo
          </button>
        </span>
      ) : null}
      {applyError ? (
        <span
          className="max-w-[220px] shrink-0 truncate rounded border border-destructive/30 bg-red-50 dark:bg-red-950/40 px-2 py-0.5 text-[11px] text-destructive"
          title={applyError}
        >
          {applyError}
        </span>
      ) : null}
    </>
  );

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
                statusChip={stagedStatusChip}
                actionsControl={
                  onDuplicate ? (
                    <button
                      type="button"
                      aria-label="Duplicate work item"
                      title="Duplicate into a new item (D)"
                      onClick={duplicateSelected}
                      className="inline-flex h-5 w-5 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      <Copy className="h-3 w-3" aria-hidden="true" />
                    </button>
                  ) : null
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
                deleteCommentError={
                  deleteCommentMutation.isError
                    ? commandErrorMessage(deleteCommentMutation.error)
                    : null
                }
                deletingCommentId={
                  deleteCommentMutation.isPending
                    ? deleteCommentMutation.variables?.commentId ?? null
                    : null
                }
                deletePending={deleteCommentMutation.isPending}
                editCommentError={
                  editCommentMutation.isError
                    ? commandErrorMessage(editCommentMutation.error)
                    : null
                }
                editingCommentId={
                  editCommentMutation.isPending
                    ? editCommentMutation.variables?.commentId ?? null
                    : null
                }
                editPending={editCommentMutation.isPending}
                mentionDisplayNames={commentMentionDisplayNames}
                onCustomPreviewFieldsChange={onCustomPreviewFieldsChange}
                onDeleteComment={deleteComment}
                onEditComment={editComment}
                preview={preview}
                selectedFieldKeys={selectedPreviewFieldKeys}
                onSelectedFieldKeysChange={setSelectedPreviewFieldKeys}
                tagsPending={applying}
                onTagsChange={stageTags}
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
                        ? (customFieldValuesQuery.data ?? [])
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
                    options={statesQuery.data ?? []}
                    pending={applying}
                    shortcut="S"
                  />
                }
                assigneeControl={
                  <AssigneePicker
                    current={staged.assignee?.displayName ?? preview.assignedTo}
                    error={
                      assigneeQuery.trim()
                        ? assigneeOptionsQuery.isError
                          ? commandErrorMessage(assigneeOptionsQuery.error)
                          : null
                        : assigneeDefaultQuery.isError
                          ? commandErrorMessage(assigneeDefaultQuery.error)
                          : null
                    }
                    mutationError={null}
                    loading={assigneeDefaultQuery.isLoading || assigneeOptionsQuery.isLoading}
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
              />
              <CommentComposer
                focusCommentRequest={focusCommentRequest}
                hasStagedChanges={stagedEntries.length > 0}
                mentionPriorityNames={mentionPriorityNames}
                onApplyStaged={() => {
                  void applyStaged();
                }}
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

function PresetMenu({
  canSave,
  onApply,
  onDelete,
  onSave,
  presets,
  stagedCount,
}: {
  canSave: boolean;
  onApply: (preset: WorkItemFieldPreset) => void;
  onDelete: (id: string) => void;
  onSave: (name: string) => void;
  presets: WorkItemFieldPreset[];
  stagedCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const menuRef = useCloseOnOutsidePointer<HTMLDivElement>(open, () => setOpen(false));

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Field presets"
        title="Field presets — press 1-9 to apply"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-5 w-5 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Zap className="h-3 w-3" aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-md border border-border bg-popover p-1 shadow-lg">
          <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">
            Field presets
          </div>
          {presets.length > 0 ? (
            presets.map((preset, index) => (
              <div
                key={preset.id}
                className="group flex items-center gap-1 rounded hover:bg-muted"
              >
                <button
                  type="button"
                  onClick={() => {
                    onApply(preset);
                    setOpen(false);
                  }}
                  title={preset.fields
                    .map((field) => `${field.label}: ${field.value}`)
                    .join("\n")}
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left text-xs"
                >
                  <ShortcutHint>{index + 1}</ShortcutHint>
                  <span className="truncate">{preset.name}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete preset ${preset.name}`}
                  onClick={() => onDelete(preset.id)}
                  className="mr-1 rounded p-0.5 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            ))
          ) : (
            <p className="px-2 py-1 text-[11px] text-muted-foreground">No presets yet.</p>
          )}
          <div className="mt-1 border-t border-border px-2 py-1.5">
            {canSave ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  const trimmed = name.trim();
                  if (!trimmed) return;
                  onSave(trimmed);
                  setName("");
                }}
              >
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={`Save ${stagedCount} pending as…`}
                  aria-label="New preset name"
                  className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-xs outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  disabled={!name.trim() || presets.length >= MAX_FIELD_PRESETS}
                  className="h-6 rounded border border-border bg-card px-2 text-xs hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save
                </button>
              </form>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Stage changes (state, reason, …), then save them here as a preset.
              </p>
            )}
            {presets.length >= MAX_FIELD_PRESETS ? (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Up to {MAX_FIELD_PRESETS} presets.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

