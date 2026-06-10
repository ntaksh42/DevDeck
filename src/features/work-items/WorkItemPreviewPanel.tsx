import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Send, SlidersHorizontal, Trash2, X } from 'lucide-react';
import {
  addWorkItemComment,
  assignWorkItem,
  deleteWorkItemComment,
  fetchWorkItemImage,
  listOrganizations,
  listWorkItemFields,
  setWorkItemState,
  setWorkItemReason,
  setWorkItemPriority,
  listWorkItemTypeStates,
  searchWorkItemAssignees,
  searchWorkItemMentions,
  recordMentionInteraction,
  commandErrorMessage,
  type MentionCandidate,
  type Organization,
  type WorkItemAssigneeCandidate,
  type WorkItemFieldOption,
  type WorkItemPreview,
  type WorkItemSummary,
} from '@/lib/azdoCommands';
import { formatRelativeDate, isEditableTarget } from '@/lib/utils';
import { PreviewEmptyState } from '@/components/StateDisplay';
import { ShortcutHint } from '@/components/ShortcutHint';
import { invalidateWorkItemQueryViews, workItemQueryKeys } from './queryKeys';
import {
  DEFAULT_PREVIEW_FIELD_KEYS,
  isValidFieldReferenceName,
  loadPreviewFieldKeys,
  storeCustomPreviewFields,
  storePreviewFieldKeys,
  type CustomPreviewField,
  type PreviewFieldKey,
} from './previewFieldsStorage';
const SAVED_REPLIES_STORAGE_KEY = "azdodeck:workItems:savedReplies";

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

function loadSavedReplies(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SAVED_REPLIES_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function storeSavedReplies(replies: string[]) {
  window.localStorage.setItem(SAVED_REPLIES_STORAGE_KEY, JSON.stringify(replies.slice(0, 20)));
}

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

export function WorkItemPreviewPanel({
  customPreviewFields,
  focusCommentRequest,
  openAssigneeRequest,
  openPriorityRequest,
  openStateRequest,
  onCustomPreviewFieldsChange,
  preview,
  previewError,
  previewLoading,
  selectedItem,
  onPreviewUpdated,
}: {
  customPreviewFields: CustomPreviewField[];
  focusCommentRequest?: number;
  openAssigneeRequest?: number;
  openPriorityRequest?: number;
  openStateRequest?: number;
  onCustomPreviewFieldsChange: (fields: CustomPreviewField[]) => void;
  preview: WorkItemPreview | null;
  previewError: string | null;
  previewLoading: boolean;
  selectedItem: WorkItemSummary | null;
  onPreviewUpdated?: (preview: WorkItemPreview) => void;
}) {
  const [commentText, setCommentText] = useState("");
  const [savedReplies, setSavedReplies] = useState<string[]>(() => loadSavedReplies());
  const [selectedPreviewFieldKeys, setSelectedPreviewFieldKeys] = useState<PreviewFieldKey[]>(
    () => loadPreviewFieldKeys(),
  );
  const [selectedMentions, setSelectedMentions] = useState<SelectedMention[]>([]);
  const mentionsToRecordRef = useRef<
    Array<{ id: string; displayName: string; uniqueName: string; organizationId: string }>
  >([]);
  const [mentionDisplayNamesById, setMentionDisplayNamesById] = useState<
    Record<string, string>
  >({});
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const queryClient = useQueryClient();
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [statePickerOpen, setStatePickerOpen] = useState(false);
  const [reasonEditorOpen, setReasonEditorOpen] = useState(false);
  const [priorityPickerOpen, setPriorityPickerOpen] = useState(false);
  const handledFocusCommentRequest = useRef(0);
  const handledOpenAssigneeRequest = useRef(0);
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

  const mentionOptionsQuery = useQuery({
    queryKey: workItemQueryKeys.mentions(
      selectedItem?.organizationId,
      selectedItem?.projectId,
      selectedItem?.id,
      mentionQuery,
    ),
    queryFn: () =>
      searchWorkItemMentions({
        organizationId: selectedItem!.organizationId,
        projectId: selectedItem!.projectId,
        workItemId: selectedItem!.id,
        query: mentionQuery,
      }),
    enabled: !!selectedItem && mentionStart !== null,
    staleTime: 60_000,
  });
  const mentionOptions = useMemo(
    () =>
      rankMentionCandidates({
        recent: recentMentionOptions.filter((c) => !isSelfIdentity(c, selfOrg)),
        remote: (mentionOptionsQuery.data ?? []).filter((c) => !isSelfIdentity(c, selfOrg)),
        query: mentionQuery,
        priorityNames: mentionPriorityNames,
      }),
    [
      mentionOptionsQuery.data,
      mentionPriorityNames,
      mentionQuery,
      recentMentionOptions,
      selfOrg,
    ],
  );
  const showMentionOptions = mentionStart !== null && mentionOptions.length > 0;
  const showMentionError =
    mentionStart !== null && mentionOptionsQuery.isError && mentionOptions.length === 0;
  const mentionPickerRef = useCloseOnOutsidePointer<HTMLDivElement>(
    showMentionOptions,
    () => {
      setMentionStart(null);
      setMentionQuery("");
    },
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
  const assigneeOptionsQuery = useQuery({
    queryKey: workItemQueryKeys.assignees(
      selectedItem?.organizationId,
      selectedItem?.projectId,
      selectedItem?.id,
      assigneeQuery,
    ),
    queryFn: () =>
      searchWorkItemAssignees({
        organizationId: selectedItem!.organizationId,
        projectId: selectedItem!.projectId,
        workItemId: selectedItem!.id,
        query: assigneeQuery,
      }),
    enabled: !!selectedItem && assigneeOpen && assigneeQuery.trim().length > 0,
    staleTime: 60_000,
  });
  const assigneeOptions = useMemo(
    () =>
      rankMentionCandidates({
        recent: [...recentAssigneeOptions, ...(assigneeDefaultQuery.data ?? [])].filter((c) => !isSelfIdentity(c, selfOrg)),
        remote: (assigneeOptionsQuery.data ?? []).filter((c) => !isSelfIdentity(c, selfOrg)),
        query: assigneeQuery,
        priorityNames: mentionPriorityNames,
      }),
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
      return fetchWorkItemImage({
        organizationId: selectedItem.organizationId,
        url,
      });
    },
    [selectedItem],
  );

  const commentMutation = useMutation({
    mutationFn: addWorkItemComment,
    onSuccess: () => {
      for (const mention of mentionsToRecordRef.current) {
        void recordMentionInteraction({
          organizationId: mention.organizationId,
          userId: mention.id,
          displayName: mention.displayName,
          uniqueName: mention.uniqueName,
        });
      }
      mentionsToRecordRef.current = [];
      setCommentText("");
      setSelectedMentions([]);
      setMentionQuery("");
      setMentionStart(null);
      setActiveMentionIndex(0);
      void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.previewRoot() });
    },
  });

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

  const assignMutation = useMutation({
    mutationFn: assignWorkItem,
    onSuccess: (updatedPreview) => {
      onPreviewUpdated?.(updatedPreview);
      setAssigneeOpen(false);
      setAssigneeQuery("");
      queryClient.setQueryData(
        workItemQueryKeys.preview(
          updatedPreview.organizationId,
          updatedPreview.projectId,
          updatedPreview.id,
        ),
        updatedPreview,
      );
      void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.previewRoot() });
      void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.myItemsRoot() });
      invalidateWorkItemQueryViews(queryClient);
    },
  });

  const stateMutation = useMutation({
    mutationFn: setWorkItemState,
    onSuccess: (updatedPreview) => {
      onPreviewUpdated?.(updatedPreview);
      setStatePickerOpen(false);
      queryClient.setQueryData(
        workItemQueryKeys.preview(
          updatedPreview.organizationId,
          updatedPreview.projectId,
          updatedPreview.id,
        ),
        updatedPreview,
      );
      void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.previewRoot() });
      void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.myItemsRoot() });
      invalidateWorkItemQueryViews(queryClient);
    },
  });

  const reasonMutation = useMutation({
    mutationFn: setWorkItemReason,
    onSuccess: (updatedPreview) => {
      onPreviewUpdated?.(updatedPreview);
      setReasonEditorOpen(false);
      queryClient.setQueryData(
        workItemQueryKeys.preview(
          updatedPreview.organizationId,
          updatedPreview.projectId,
          updatedPreview.id,
        ),
        updatedPreview,
      );
      void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.previewRoot() });
      void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.myItemsRoot() });
      invalidateWorkItemQueryViews(queryClient);
    },
  });

  const priorityMutation = useMutation({
    mutationFn: setWorkItemPriority,
    onSuccess: (updatedPreview) => {
      onPreviewUpdated?.(updatedPreview);
      setPriorityPickerOpen(false);
      queryClient.setQueryData(
        workItemQueryKeys.preview(
          updatedPreview.organizationId,
          updatedPreview.projectId,
          updatedPreview.id,
        ),
        updatedPreview,
      );
      void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.previewRoot() });
      void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.myItemsRoot() });
      invalidateWorkItemQueryViews(queryClient);
    },
  });

  useEffect(() => {
    setAssigneeOpen(false);
    setAssigneeQuery("");
    setStatePickerOpen(false);
    setReasonEditorOpen(false);
    setPriorityPickerOpen(false);
    stateMutation.reset();
    reasonMutation.reset();
    assignMutation.reset();
    priorityMutation.reset();
    setCommentText("");
    setSelectedMentions([]);
    setMentionQuery("");
    setMentionStart(null);
    setActiveMentionIndex(0);
  }, [selectedItem?.id]);

  useEffect(() => {
    if (
      !focusCommentRequest ||
      handledFocusCommentRequest.current === focusCommentRequest
    ) {
      return;
    }
    handledFocusCommentRequest.current = focusCommentRequest;
    if (!selectedItem) return;
    textareaRef.current?.focus();
  }, [focusCommentRequest, selectedItem]);

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

  function updateMentionState(text: string, cursor: number) {
    const mention = activeMentionAt(text, cursor);
    setMentionStart(mention?.start ?? null);
    setMentionQuery(mention?.query ?? "");
    setActiveMentionIndex(0);
  }

  function applyMention(candidate: MentionCandidate) {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? commentText.length;
    const start = mentionStart ?? cursor;
    const replacement = `@${candidate.displayName} `;
    const next = `${commentText.slice(0, start)}${replacement}${commentText.slice(cursor)}`;
    const nextCursor = start + replacement.length;
    setCommentText(next);
    setSelectedMentions((current) => addSelectedMention(current, candidate));
    setMentionDisplayNamesById((current) => ({
      ...current,
      [candidate.id]: candidate.displayName,
    }));
    setMentionQuery("");
    setMentionStart(null);
    window.setTimeout(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCursor, nextCursor);
    }, 0);
  }

  function postComment() {
    if (!selectedItem || !commentText.trim() || commentMutation.isPending) return;
    mentionsToRecordRef.current = selectedMentions
      .filter(
        (m) =>
          m.uniqueName &&
          isMentionResolvableId(m.id) &&
          mentionTokenPattern(m.displayName).test(commentText),
      )
      .map((m) => ({
        id: m.id,
        displayName: m.displayName,
        uniqueName: m.uniqueName!,
        organizationId: selectedItem.organizationId,
      }));
    commentMutation.mutate({
      organizationId: selectedItem.organizationId,
      projectId: selectedItem.projectId,
      workItemId: selectedItem.id,
      markdown: renderAzureMentionMarkdown(commentText, selectedMentions),
    });
  }

  function saveCurrentReply() {
    const reply = commentText.trim();
    if (!reply) return;
    const next = [reply, ...savedReplies.filter((value) => value !== reply)].slice(0, 20);
    setSavedReplies(next);
    storeSavedReplies(next);
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

  function assignTo(candidate: WorkItemAssigneeCandidate) {
    if (!selectedItem) return;
    assignMutation.mutate({
      organizationId: selectedItem.organizationId,
      projectId: selectedItem.projectId,
      workItemId: selectedItem.id,
      assignedTo: candidate.assignValue,
    });
  }

  function setPriority(priority: number) {
    if (!selectedItem) return;
    priorityMutation.mutate({
      organizationId: selectedItem.organizationId,
      projectId: selectedItem.projectId,
      workItemId: selectedItem.id,
      priority,
    });
  }

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
    function focusComment() {
      if (!selectedItem) return;
      textareaRef.current?.focus();
    }
    function submitCurrentComment() {
      postComment();
    }

    window.addEventListener("azdodeck:work-items:open-state", openState);
    window.addEventListener("azdodeck:work-items:open-assignee", openAssignee);
    window.addEventListener("azdodeck:work-items:open-priority", openPriority);
    window.addEventListener("azdodeck:work-items:focus-comment", focusComment);
    window.addEventListener("azdodeck:work-items:post-comment", submitCurrentComment);
    return () => {
      window.removeEventListener("azdodeck:work-items:open-state", openState);
      window.removeEventListener("azdodeck:work-items:open-assignee", openAssignee);
      window.removeEventListener("azdodeck:work-items:open-priority", openPriority);
      window.removeEventListener("azdodeck:work-items:focus-comment", focusComment);
      window.removeEventListener("azdodeck:work-items:post-comment", submitCurrentComment);
    };
  }, [commentMutation.isPending, commentText, selectedItem]);

  function handlePreviewPanelKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (
      isEditableTarget(event.target) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
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
    } else if (event.key === "m" || event.key === "M") {
      event.preventDefault();
      textareaRef.current?.focus();
    }
  }

  function handleCommentKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      postComment();
      return;
    }

    if (!showMentionOptions) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveMentionIndex((index) => (index + 1) % mentionOptions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveMentionIndex(
        (index) => (index - 1 + mentionOptions.length) % mentionOptions.length,
      );
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      applyMention(mentionOptions[activeMentionIndex] ?? mentionOptions[0]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setMentionQuery("");
      setMentionStart(null);
    }
  }

  function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    postComment();
  }

  return (
    <aside
      className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-white shadow-sm transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/25"
      onKeyDown={handlePreviewPanelKeyDown}
    >
      {!selectedItem ? (
        <PreviewEmptyState message="Select a work item." />
      ) : (
        <>
          {previewError ? (
            <div className="m-3 rounded-md border border-destructive/30 bg-red-50 p-3 text-sm text-destructive">
              {previewError}
            </div>
          ) : preview ? (
            <>
              <WorkItemPreviewDetails
                customPreviewFields={customPreviewFields}
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
                mentionDisplayNames={commentMentionDisplayNames}
                onCustomPreviewFieldsChange={onCustomPreviewFieldsChange}
                onDeleteComment={deleteComment}
                preview={preview}
                selectedFieldKeys={selectedPreviewFieldKeys}
                onSelectedFieldKeysChange={setSelectedPreviewFieldKeys}
                reasonControl={
                  <ReasonEditor
                    current={preview.reason}
                    error={reasonMutation.isError ? commandErrorMessage(reasonMutation.error) : null}
                    onOpenChange={(open) => {
                      setReasonEditorOpen(open);
                      if (open) {
                        setAssigneeOpen(false);
                        setPriorityPickerOpen(false);
                        setStatePickerOpen(false);
                      }
                    }}
                    onSubmit={(reason) => {
                      if (!selectedItem) return;
                      reasonMutation.mutate({
                        organizationId: selectedItem.organizationId,
                        projectId: selectedItem.projectId,
                        workItemId: selectedItem.id,
                        reason,
                      });
                    }}
                    open={reasonEditorOpen}
                    pending={reasonMutation.isPending}
                    shortcut="R"
                  />
                }
                priorityControl={
                  <PriorityPicker
                    current={preview.priority}
                    error={priorityMutation.isError ? commandErrorMessage(priorityMutation.error) : null}
                    onOpenChange={(open) => {
                      setPriorityPickerOpen(open);
                      if (open) {
                        setAssigneeOpen(false);
                        setStatePickerOpen(false);
                      }
                    }}
                    onSelect={setPriority}
                    open={priorityPickerOpen}
                    pending={priorityMutation.isPending}
                    shortcut="P"
                  />
                }
                resolveImageSource={resolvePreviewImage}
                stateControl={
                  <StatePicker
                    current={preview.state}
                    error={stateMutation.isError ? commandErrorMessage(stateMutation.error) : null}
                    loading={statesQuery.isFetching}
                    onOpenChange={(open) => {
                      setStatePickerOpen(open);
                      if (open) {
                        setAssigneeOpen(false);
                        setPriorityPickerOpen(false);
                      }
                    }}
                    onSelect={(state) => {
                      if (!selectedItem) return;
                      setPriorityPickerOpen(false);
                      stateMutation.mutate({
                        organizationId: selectedItem.organizationId,
                        projectId: selectedItem.projectId,
                        workItemId: selectedItem.id,
                        state,
                      });
                    }}
                    open={statePickerOpen}
                    options={statesQuery.data ?? []}
                    pending={stateMutation.isPending}
                    shortcut="S"
                  />
                }
                assigneeControl={
                  <AssigneePicker
                    current={preview.assignedTo}
                    error={
                      assigneeQuery.trim()
                        ? assigneeOptionsQuery.isError
                          ? commandErrorMessage(assigneeOptionsQuery.error)
                          : null
                        : assigneeDefaultQuery.isError
                          ? commandErrorMessage(assigneeDefaultQuery.error)
                          : null
                    }
                    mutationError={assignMutation.isError ? commandErrorMessage(assignMutation.error) : null}
                    loading={assigneeDefaultQuery.isFetching || assigneeOptionsQuery.isFetching}
                    onOpenChange={(open) => {
                      setAssigneeOpen(open);
                      if (open) setPriorityPickerOpen(false);
                    }}
                    onQueryChange={setAssigneeQuery}
                    onSelect={assignTo}
                    open={assigneeOpen}
                    options={assigneeOptions}
                    pending={assignMutation.isPending}
                    query={assigneeQuery}
                    shortcut="A"
                  />
                }
              />
              <div className="bg-slate-50/70 p-2">
                <form className="space-y-1" onSubmit={submitComment}>
                  <div ref={mentionPickerRef} className="relative">
                    <textarea
                      ref={textareaRef}
                      data-work-item-comment-input="true"
                      value={commentText}
                      onChange={(event) => {
                        setCommentText(event.target.value);
                        updateMentionState(
                          event.target.value,
                          event.target.selectionStart,
                        );
                      }}
                      onClick={(event) => {
                        updateMentionState(
                          event.currentTarget.value,
                          event.currentTarget.selectionStart,
                        );
                      }}
                      onKeyDown={handleCommentKeyDown}
                      aria-label="Comment"
                      aria-keyshortcuts="M Alt+M Control+Enter Meta+Enter"
                      placeholder="Add a comment..."
                      rows={2}
                      className="min-h-[36px] w-full resize-none rounded-md border border-input bg-white px-2 py-1.5 text-sm outline-none transition-[border-color,box-shadow,min-height] focus:min-h-[64px] focus:border-primary focus:ring-4 focus:ring-primary/20"
                    />
                    {showMentionOptions ? (
                      <div className="absolute bottom-full left-0 z-20 mb-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-white py-1 shadow-lg">
                        {mentionOptions.map((candidate, index) => (
                          <button
                            key={candidate.id}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyMention(candidate)}
                            className={`flex w-full min-w-0 flex-col px-3 py-2 text-left text-sm ${
                              index === activeMentionIndex ? "bg-secondary" : "hover:bg-muted"
                            }`}
                          >
                            <span className="truncate font-medium">
                              {candidate.displayName}
                            </span>
                            {candidate.uniqueName ? (
                              <span className="truncate text-xs text-muted-foreground">
                                {candidate.uniqueName}
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ) : showMentionError ? (
                      <div className="absolute bottom-full left-0 z-20 mb-1 w-full rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] text-destructive shadow-lg">
                        Search failed: {commandErrorMessage(mentionOptionsQuery.error)}
                      </div>
                    ) : null}
                  </div>
                  {commentMutation.isError ? (
                    <p className="text-xs text-destructive">
                      {commandErrorMessage(commentMutation.error)}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1">
                      {savedReplies.length > 0 ? (
                        <select
                          aria-label="Saved replies"
                          value=""
                          onChange={(event) => {
                            if (!event.target.value) return;
                            setCommentText(event.target.value);
                            event.target.value = "";
                          }}
                          className="h-6 rounded border border-input bg-white px-1 text-xs"
                        >
                          <option value="">Saved replies</option>
                          {savedReplies.map((reply, index) => (
                            <option key={`${index}:${reply}`} value={reply}>
                              {reply.slice(0, 60)}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      <button
                        type="button"
                        disabled={!commentText.trim()}
                        onClick={saveCurrentReply}
                        className="h-6 rounded border border-border bg-white px-2 text-xs hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Save reply
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="flex items-center gap-0.5">
                        <ShortcutHint>Alt+M</ShortcutHint>
                        <ShortcutHint>Ctrl+Enter</ShortcutHint>
                      </span>
                      {commentMutation.isSuccess ? (
                        <span className="text-xs text-muted-foreground">Comment posted</span>
                      ) : null}
                      <button
                        type="submit"
                        aria-label="Post comment"
                        disabled={!commentText.trim() || commentMutation.isPending}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {commentMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Send className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Post
                      </button>
                    </div>
                  </div>
                </form>
              </div>
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

function WorkItemPreviewDetails({
  customPreviewFields,
  preview,
  assigneeControl,
  deleteCommentError,
  deletingCommentId,
  deletePending,
  mentionDisplayNames,
  onCustomPreviewFieldsChange,
  onDeleteComment,
  onSelectedFieldKeysChange,
  priorityControl,
  reasonControl,
  resolveImageSource,
  selectedFieldKeys,
  stateControl,
}: {
  customPreviewFields: CustomPreviewField[];
  preview: WorkItemPreview;
  assigneeControl: ReactNode;
  deleteCommentError: string | null;
  deletingCommentId: number | null;
  deletePending: boolean;
  mentionDisplayNames: ReadonlyMap<string, string>;
  onCustomPreviewFieldsChange: (fields: CustomPreviewField[]) => void;
  onDeleteComment: (commentId: number) => void;
  onSelectedFieldKeysChange: (keys: PreviewFieldKey[]) => void;
  priorityControl: ReactNode;
  reasonControl: ReactNode;
  resolveImageSource: (url: string) => Promise<string | null>;
  selectedFieldKeys: PreviewFieldKey[];
  stateControl: ReactNode;
}) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
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
      aria-keyshortcuts="Alt+P"
      aria-label="Work item preview"
      className="min-h-0 flex-1 overflow-auto bg-white px-2.5 pb-2 pt-1.5 text-xs outline-none focus:bg-primary/[0.02] focus:ring-2 focus:ring-inset focus:ring-primary"
      data-primary-preview="true"
      onKeyDown={stopPreviewNavigationKeyDown}
      tabIndex={-1}
    >
      <div className="border-b border-border pb-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex min-w-0 items-baseline gap-1.5 text-sm font-semibold leading-5">
            <span className="shrink-0 text-[11px] font-normal text-muted-foreground">#{preview.id}</span>
            <span className="truncate text-foreground">{preview.title}</span>
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            <div ref={fieldMenuRef} className="relative">
              <button
                type="button"
                aria-expanded={fieldMenuOpen}
                aria-label="Configure preview fields"
                title="Configure preview fields"
                onClick={() => setFieldMenuOpen((open) => !open)}
                className="inline-flex h-5 w-5 items-center justify-center rounded border border-border bg-white text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
              </button>
              {fieldMenuOpen ? (
                <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-md border border-border bg-white p-1 shadow-lg">
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
                    <div className="mb-1.5 max-h-28 overflow-auto rounded border border-border bg-slate-50">
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
                            className="flex w-full min-w-0 items-center gap-2 px-2 py-1 text-left text-[11px] hover:bg-white"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{field.name}</span>
                              <span className="block truncate font-mono text-[10px] text-muted-foreground">
                                {field.referenceName}
                              </span>
                            </span>
                            <span className="shrink-0 rounded border border-border bg-white px-1 text-[10px] text-muted-foreground">
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
                              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-white hover:text-foreground"
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
        <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-x-1.5 gap-y-0 pt-0.5">
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
            <PreviewField
              key={field.referenceName}
              label={field.label}
              value={customPreviewFieldValue(preview, field.referenceName) ?? "—"}
              wide
            />
          ))}
        </div>
      </div>

      {(descriptionHtml || acceptanceCriteriaHtml) && (
        <div className="mt-2 grid gap-2">
          {descriptionHtml ? (
            <PreviewSection title="Description">
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
            <PreviewSection title="Acceptance Criteria">
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
        <PreviewSection className="mt-2" title={`Comments (${preview.comments.length})`}>
          {deleteCommentError ? (
            <p className="mb-1 text-[11px] leading-4 text-destructive">
              {deleteCommentError}
            </p>
          ) : null}
          <div className="space-y-2">
            {preview.comments.map((comment) => {
              const deleting = deletingCommentId === comment.id;
              return (
                <CollapsibleComment
                  baseUrl={preview.webUrl}
                  commentHtml={commentRichHtml(
                    comment.renderedText,
                    comment.text,
                    mentionDisplayNames,
                  )}
                  createdBy={comment.createdBy}
                  createdDate={comment.createdDate}
                  deleting={deleting}
                  deletePending={deletePending}
                  id={comment.id}
                  key={comment.id}
                  onDelete={onDeleteComment}
                  onImageOpen={setLightboxSrc}
                  resolveImageSource={resolveImageSource}
                />
              );
            })}
          </div>
        </PreviewSection>
      ) : null}
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

function CollapsibleComment({
  baseUrl,
  commentHtml,
  createdBy,
  createdDate,
  deleting,
  deletePending,
  id,
  onDelete,
  onImageOpen,
  resolveImageSource,
}: {
  baseUrl?: string | null;
  commentHtml: string;
  createdBy: string | null;
  createdDate: string | null;
  deleting: boolean;
  deletePending: boolean;
  id: number;
  onDelete: (commentId: number) => void;
  onImageOpen: (src: string) => void;
  resolveImageSource: (url: string) => Promise<string | null>;
}) {
  const [expanded, setExpanded] = useState(commentHtml.length < 700);
  const collapsible = commentHtml.length >= 700;

  return (
    <article className="group min-w-0 overflow-hidden rounded-md border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex min-w-0 items-center gap-1.5 border-b border-border bg-slate-50 px-2 py-1">
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-semibold text-blue-700">
          {commentAuthorInitials(createdBy)}
        </span>
        <span className="min-w-0 truncate font-semibold">
          {createdBy ?? "Unknown"}
        </span>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">commented</span>
        {createdDate ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatRelativeDate(createdDate)}
          </span>
        ) : null}
        <button
          type="button"
          aria-label={`Delete comment ${id}`}
          className={`ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-transparent text-muted-foreground transition-opacity hover:border-border hover:bg-white hover:text-destructive disabled:cursor-not-allowed ${deleting ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
          disabled={deletePending}
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
      <div className="px-3 py-2.5">
        <div className={expanded ? "" : "max-h-32 overflow-hidden"}>
          <RichHtmlFrame
            baseUrl={baseUrl}
            density="comfortable"
            framed={false}
            html={commentHtml}
            title={`Comment by ${createdBy ?? "Unknown"}`}
            resolveImageSource={resolveImageSource}
            onImageOpen={onImageOpen}
            minHeight={34}
          />
        </div>
        {collapsible ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="mt-1 rounded border border-border bg-white px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        ) : null}
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

function customPreviewFieldValue(preview: WorkItemPreview, referenceName: string): string | null {
  return (
    preview.customFields.find(
      (field) => field.referenceName.toLowerCase() === referenceName.toLowerCase(),
    )?.value ?? null
  );
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
      <dt className="shrink-0 text-[10px] leading-4 text-muted-foreground">{label}</dt>
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

function PreviewSection({
  children,
  className = "",
  title,
}: {
  children: ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <section className={`min-w-0 ${className}`}>
      <div className="mb-1 border-t border-border pt-1">
        <h3 className="text-[11px] font-semibold leading-4 text-foreground/75">
          {title}
        </h3>
      </div>
      {children}
    </section>
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

function hydrateAuthenticatedImages(
  doc: Document,
  baseUrl: string | null | undefined,
  resolveImageSource: ((url: string) => Promise<string | null>) | undefined,
  syncHeight: () => void,
) {
  if (!resolveImageSource) return;

  for (const image of Array.from(doc.querySelectorAll("img"))) {
    const rawSrc = image.getAttribute("src");
    if (!rawSrc || isInlineImageSource(rawSrc) || image.dataset.azdoImageHydrated) {
      continue;
    }

    const absoluteUrl = toAbsoluteHttpUrl(rawSrc, baseUrl);
    if (!absoluteUrl) continue;
    if (!isWorkItemAttachmentUrl(absoluteUrl)) continue;

    image.dataset.azdoImageHydrated = "true";
    void resolveImageSource(absoluteUrl)
      .then((dataUrl) => {
        if (!dataUrl || !image.isConnected) return;
        image.src = dataUrl;
        syncHeight();
      })
      .catch(() => {
        image.dataset.azdoImageError = "true";
        const fallback = doc.createElement("span");
        fallback.textContent = "Image could not be loaded. Check Azure DevOps auth or attachment permissions.";
        fallback.className = "azdo-image-error";
        image.replaceWith(fallback);
        syncHeight();
      });
  }
}

function isWorkItemAttachmentUrl(src: string): boolean {
  try {
    return new URL(src).pathname.toLowerCase().includes("/_apis/wit/attachments/");
  } catch {
    return false;
  }
}

function isInlineImageSource(src: string): boolean {
  return /^(data|blob):/i.test(src);
}

function toAbsoluteHttpUrl(src: string, baseUrl: string | null | undefined): string | null {
  try {
    const url = new URL(src, baseUrl || window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function buildRichHtmlDocument(
  html: string,
  density: "compact" | "comfortable" = "compact",
): string {
  const fontSize = density === "comfortable" ? 14 : 12;
  const lineHeight = density === "comfortable" ? 1.55 : 1.35;
  const paragraphMargin = density === "comfortable" ? 10 : 6;
  return `<!doctype html>
<html>
<head>
  <base target="_blank">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body { margin: 0; padding: 0; background: #fff; }
    body {
      box-sizing: border-box;
      color: #0f172a;
      font: ${fontSize}px/${lineHeight} -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow-wrap: anywhere;
    }
    * { box-sizing: border-box; }
    p { margin: 0 0 ${paragraphMargin}px; }
    p:last-child, ul:last-child, ol:last-child, table:last-child, pre:last-child { margin-bottom: 0; }
    ul, ol { margin: 0 0 ${paragraphMargin}px 20px; padding: 0; }
    li { margin: 3px 0; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    img, video { max-width: 100%; height: auto; border: 1px solid #dbe3ef; border-radius: 4px; }
    img { cursor: zoom-in; }
    .azdo-image-error {
      display: inline-block;
      margin: 2px 0;
      padding: 6px 8px;
      color: #991b1b;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 4px;
    }
    table { width: 100%; margin: 0 0 ${paragraphMargin}px; border-collapse: collapse; font-size: ${fontSize}px; }
    th, td { border: 1px solid #dbe3ef; padding: 5px 7px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; font-weight: 600; }
    pre, code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; }
    pre { margin: 0 0 6px; padding: 6px; overflow: auto; border: 1px solid #dbe3ef; border-radius: 4px; background: #f8fafc; }
    blockquote { margin: 0 0 6px; padding-left: 8px; border-left: 2px solid #cbd5e1; color: #475569; }
  </style>
</head>
<body>${html}</body>
</html>`;
}

function normalizeRichHtml(value: string | null | undefined): string | null {
  const html = decodeEscapedRichHtml(value)?.trim();
  if (!html) return null;
  if (/<\/?[a-z][^>]*>/i.test(html) || /<(img|video|table|pre|blockquote|ul|ol|li|a)\b/i.test(html)) {
    return html;
  }
  return null;
}

function richFieldHtml(value: string | null | undefined): string | null {
  return normalizeRichHtml(value) ?? markdownishTextToHtml(value);
}

function decodeEscapedRichHtml(value: string | null | undefined): string | null {
  const html = value?.trim();
  if (!html) return null;
  if (!/&lt;\/?(?:a|blockquote|br|div|img|li|ol|p|pre|span|strong|table|td|th|tr|ul)\b/i.test(html)) {
    return html;
  }
  const decoded = decodeBasicHtmlEntities(html);
  return /<\/?[a-z][^>]*>/i.test(decoded) ? decoded : html;
}

function commentRichHtml(
  renderedText: string | null | undefined,
  plainText: string | null | undefined,
  mentionDisplayNames: ReadonlyMap<string, string>,
): string {
  const rendered = replaceAzureMentionDisplayNamesInHtml(
    renderedText,
    mentionDisplayNames,
  );
  const plain = replaceAzureMentionDisplayNamesInText(
    plainText,
    mentionDisplayNames,
  );
  return (
    normalizeRichHtml(rendered) ??
    normalizeRichHtml(plain) ??
    markdownishTextToHtml(plain) ??
    "No text"
  );
}

function markdownishTextToHtml(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let listItems: string[] = [];
  let tableRows: string[][] = [];
  let codeLines: string[] = [];
  let inCode = false;

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };
  const flushTable = () => {
    if (tableRows.length === 0) return;
    const [head, ...body] = tableRows;
    blocks.push(
      `<table><thead><tr>${head.map((cell) => `<th>${formatInlineMarkdown(cell)}</th>`).join("")}</tr></thead><tbody>${body
        .map((row) => `<tr>${row.map((cell) => `<td>${formatInlineMarkdown(cell)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`,
    );
    tableRows = [];
  };
  const flushCode = () => {
    if (codeLines.length === 0) return;
    blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n")) ?? ""}</code></pre>`);
    codeLines = [];
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inCode) {
        inCode = false;
        flushCode();
      } else {
        flushList();
        flushTable();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      flushTable();
      continue;
    }

    const listMatch = /^[-*]\s+(.+)$/.exec(trimmed);
    if (listMatch) {
      flushTable();
      listItems.push(listMatch[1]);
      continue;
    }

    if (isMarkdownTableRow(trimmed)) {
      flushList();
      if (!/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(trimmed)) {
        tableRows.push(splitMarkdownTableRow(trimmed));
      }
      continue;
    }

    flushList();
    flushTable();
    blocks.push(`<p>${formatInlineMarkdown(trimmed)}</p>`);
  }

  flushList();
  flushTable();
  flushCode();
  return blocks.join("");
}

function isMarkdownTableRow(value: string): boolean {
  return value.includes("|") && splitMarkdownTableRow(value).length >= 2;
}

function splitMarkdownTableRow(value: string): string[] {
  return value.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function formatInlineMarkdown(value: string): string {
  let html = escapeHtml(value) ?? "";
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return html;
}

function commentAuthorInitials(name: string | null | undefined): string {
  const normalized = name?.trim();
  if (!normalized) return "?";
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return [...normalized].slice(0, 2).join("").toUpperCase();
}

function replaceAzureMentionDisplayNamesInHtml(
  value: string | null | undefined,
  mentionDisplayNames: ReadonlyMap<string, string>,
): string | null | undefined {
  if (!value || mentionDisplayNames.size === 0) return value;
  return value.replace(
    /@(?:<|&lt;)([^<>&]+)(?:>|&gt;)/g,
    (token, encodedId: string) => {
      const displayName = mentionDisplayNameForId(
        mentionDisplayNames,
        encodedId,
      );
      return displayName ? `@${escapeHtml(displayName) ?? displayName}` : token;
    },
  );
}

function replaceAzureMentionDisplayNamesInText(
  value: string | null | undefined,
  mentionDisplayNames: ReadonlyMap<string, string>,
): string | null | undefined {
  if (!value || mentionDisplayNames.size === 0) return value;
  return value.replace(/@<([^>]+)>/g, (token, id: string) => {
    const displayName = mentionDisplayNameForId(mentionDisplayNames, id);
    return displayName ? `@${displayName}` : token;
  });
}

function mentionDisplayNameForId(
  mentionDisplayNames: ReadonlyMap<string, string>,
  id: string,
): string | null {
  const normalizedId = decodeBasicHtmlEntities(id).trim();
  return (
    mentionDisplayNames.get(normalizedId) ??
    mentionDisplayNames.get(normalizedId.toLowerCase()) ??
    null
  );
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeHtml(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function useCloseOnOutsidePointer<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || ref.current?.contains(target)) {
        return;
      }
      onClose();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [onClose, open]);

  return ref;
}

function ReasonEditor({
  current,
  error,
  onOpenChange,
  onSubmit,
  open,
  pending,
  shortcut,
}: {
  current: string | null;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => void;
  open: boolean;
  pending: boolean;
  shortcut?: string;
}) {
  const [draft, setDraft] = useState(current ?? "");
  const editorRef = useCloseOnOutsidePointer<HTMLDivElement>(open, () =>
    onOpenChange(false),
  );

  useEffect(() => {
    if (open) setDraft(current ?? "");
  }, [current, open]);

  function save() {
    const reason = draft.trim();
    if (!reason || reason === (current ?? "").trim() || pending) return;
    onSubmit(reason);
  }

  return (
    <div ref={editorRef} className="relative min-w-0">
      <button
        type="button"
        aria-label="Change reason"
        aria-keyshortcuts={shortcut}
        disabled={pending}
        onClick={() => onOpenChange(!open)}
        className="max-w-full truncate rounded px-1 text-left text-xs leading-4 text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
        title={current ?? "—"}
      >
        {pending ? "Updating..." : (current ?? "—")}
      </button>
      {error && (
        <p className="mt-0.5 text-[10px] text-destructive">{error}</p>
      )}
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-md border border-border bg-white p-2 shadow-lg">
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onOpenChange(false);
              } else if (event.key === "Enter") {
                event.preventDefault();
                save();
              }
            }}
            placeholder="Reason"
            className="h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-2 flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!draft.trim() || draft.trim() === (current ?? "").trim() || pending}
              onClick={save}
              className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatePicker({
  current,
  error,
  loading,
  onOpenChange,
  onSelect,
  open,
  options,
  pending,
  shortcut,
}: {
  current: string | null;
  error?: string | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (state: string) => void;
  open: boolean;
  options: string[];
  pending: boolean;
  shortcut?: string;
}) {
  const pickerRef = useCloseOnOutsidePointer<HTMLDivElement>(open, () =>
    onOpenChange(false),
  );
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !open) triggerRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);

  return (
    <div ref={pickerRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Change state"
        aria-keyshortcuts={shortcut}
        disabled={pending}
        onClick={() => onOpenChange(!open)}
        className="max-w-full truncate rounded px-1 text-left text-xs leading-4 text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
        title={current ?? "—"}
      >
        {pending ? "Updating..." : (current ?? "—")}
      </button>
      {error && (
        <p className="mt-0.5 text-[10px] text-destructive">{error}</p>
      )}
      {open ? (
        <div ref={listRef} className="absolute left-0 top-full z-30 mt-1 min-w-[120px] rounded-md border border-border bg-white py-1 shadow-lg">
          {loading ? (
            <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Loading…
            </div>
          ) : options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No states available</div>
          ) : (
            options.map((state, index) => (
              <button
                key={state}
                type="button"
                autoFocus={index === 0}
                onClick={() => onSelect(state)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.preventDefault(); onOpenChange(false); }
                  else if (e.key === "Enter") { e.stopPropagation(); }
                  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
                    const i = buttons.indexOf(e.currentTarget);
                    if (e.key === "ArrowDown") buttons[i + 1]?.focus();
                    else if (i > 0) buttons[i - 1].focus();
                  }
                }}
                className={`flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs ${
                  state === current
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${state === current ? "bg-primary" : "bg-transparent"}`}
                />
                {state}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function PriorityPicker({
  current,
  error,
  onOpenChange,
  onSelect,
  open,
  pending,
  shortcut,
}: {
  current: string | null;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (priority: number) => void;
  open: boolean;
  pending: boolean;
  shortcut?: string;
}) {
  const pickerRef = useCloseOnOutsidePointer<HTMLDivElement>(open, () =>
    onOpenChange(false),
  );
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !open) triggerRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);
  const options = [1, 2, 3, 4];

  return (
    <div ref={pickerRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Change priority"
        aria-keyshortcuts={shortcut}
        disabled={pending}
        onClick={() => onOpenChange(!open)}
        className="max-w-full truncate rounded px-1 text-left text-xs leading-4 text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
        title={current ?? "—"}
      >
        {pending ? "Updating..." : (current ?? "—")}
      </button>
      {error && (
        <p className="mt-0.5 text-[10px] text-destructive">{error}</p>
      )}
      {open ? (
        <div ref={listRef} className="absolute left-0 top-full z-30 mt-1 min-w-[96px] rounded-md border border-border bg-white py-1 shadow-lg">
          {options.map((priority, index) => {
            const value = String(priority);
            return (
              <button
                key={priority}
                type="button"
                autoFocus={index === 0}
                onClick={() => onSelect(priority)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.preventDefault(); onOpenChange(false); }
                  else if (e.key === "Enter") { e.stopPropagation(); }
                  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
                    const i = buttons.indexOf(e.currentTarget);
                    if (e.key === "ArrowDown") buttons[i + 1]?.focus();
                    else if (i > 0) buttons[i - 1].focus();
                  }
                }}
                className={`flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs ${
                  value === current
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${value === current ? "bg-primary" : "bg-transparent"}`}
                />
                {priority}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function AssigneePicker({
  current,
  error,
  mutationError,
  loading,
  onOpenChange,
  onQueryChange,
  onSelect,
  open,
  options,
  pending,
  query,
  shortcut,
}: {
  current: string | null;
  error: string | null;
  mutationError?: string | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  onSelect: (candidate: WorkItemAssigneeCandidate) => void;
  open: boolean;
  options: WorkItemAssigneeCandidate[];
  pending: boolean;
  query: string;
  shortcut?: string;
}) {
  const pickerRef = useCloseOnOutsidePointer<HTMLDivElement>(open, () =>
    onOpenChange(false),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !open) triggerRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);

  return (
    <div ref={pickerRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Change assignee"
        aria-keyshortcuts={shortcut}
        disabled={pending}
        onClick={() => onOpenChange(!open)}
        className="max-w-full truncate rounded px-1 text-left text-xs leading-4 text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
        title={current ?? "Unassigned"}
      >
        {pending ? "Updating..." : current ?? "Unassigned"}
      </button>
      {mutationError && (
        <p className="mt-0.5 text-[10px] text-destructive">{mutationError}</p>
      )}
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-md border border-border bg-white p-1 shadow-lg">
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onOpenChange(false);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                listRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
              }
            }}
            placeholder="Search assignee..."
            className="mb-1 h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
          />
          <div ref={listRef} className="max-h-44 overflow-auto">
            {error ? (
              <div className="mb-1 rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
                Search failed: {error}
              </div>
            ) : null}
            {loading ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">Searching...</div>
            ) : options.length > 0 ? (
              options.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => onSelect(candidate)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { e.preventDefault(); onOpenChange(false); }
                    else if (e.key === "Enter") { e.stopPropagation(); }
                    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
                      const i = buttons.indexOf(e.currentTarget);
                      if (e.key === "ArrowDown") buttons[i + 1]?.focus();
                      else if (i > 0) buttons[i - 1].focus();
                      else inputRef.current?.focus();
                    }
                  }}
                  className="flex w-full min-w-0 flex-col rounded px-2 py-1 text-left text-xs hover:bg-secondary"
                >
                  <span className="truncate font-medium">{candidate.displayName}</span>
                  {candidate.uniqueName ? (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {candidate.uniqueName}
                    </span>
                  ) : null}
                </button>
              ))
            ) : (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                {query.trim() ? "No matches" : "No recent assignees"}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function recentWorkItemMentionCandidates(
  preview: WorkItemPreview | null,
): MentionCandidate[] {
  if (!preview) return [];
  const candidates = new Map<string, MentionCandidate>();
  for (const comment of preview.comments) {
    if (!comment.createdById || !comment.createdBy) continue;
    if (isAzureDevOpsServiceIdentityName(comment.createdBy, comment.createdByUniqueName)) {
      continue;
    }
    candidates.set(comment.createdById, {
      id: comment.createdById,
      displayName: comment.createdBy,
      uniqueName: comment.createdByUniqueName ?? null,
    });
  }
  return [...candidates.values()];
}

function recentWorkItemAssigneeCandidates(
  preview: WorkItemPreview | null,
): WorkItemAssigneeCandidate[] {
  if (!preview) return [];
  return recentWorkItemMentionCandidates(preview)
    .filter((candidate) => candidate.uniqueName)
    .map((candidate) => ({
      ...candidate,
      assignValue: `${candidate.displayName} <${candidate.uniqueName}>`,
    }));
}

export function isSelfIdentity(
  candidate: MentionCandidate,
  org: Organization | undefined,
): boolean {
  if (!org) return false;
  const uid = org.authenticatedUserId?.toLowerCase() ?? "";
  const selfUnique = org.authenticatedUserUniqueName?.toLowerCase() ?? "";
  const dn = org.authenticatedUserDisplayName?.toLowerCase() ?? "";
  const cid = candidate.id.toLowerCase();
  const cdisplay = candidate.displayName.toLowerCase();
  const cunique = candidate.uniqueName?.toLowerCase() ?? "";
  if (uid !== "" && (cid === uid || (cunique !== "" && cunique === uid))) {
    return true;
  }
  if (selfUnique !== "" && cunique !== "" && cunique === selfUnique) {
    return true;
  }
  if (dn !== "" && cdisplay === dn) {
    // Same display name but a unique name that belongs to someone else:
    // a namesake colleague must stay in the candidate list.
    const provablyDifferent =
      selfUnique !== "" && cunique !== "" && cunique !== selfUnique;
    return !provablyDifferent;
  }
  return false;
}

function workItemMentionPriorityNames(preview: WorkItemPreview | null): string[] {
  if (!preview) return [];
  const names = [
    ...preview.comments.map((comment) => comment.createdBy),
    preview.createdBy,
    preview.assignedTo,
  ];
  return uniqueNormalizedNames(names);
}

export function rankMentionCandidates<T extends MentionCandidate>({
  recent,
  remote,
  query,
  priorityNames,
}: {
  recent: T[];
  remote: T[];
  query: string;
  priorityNames: string[];
}): T[] {
  const term = query.trim().toLowerCase();
  const recentIndexes = buildMentionCandidateIndex(recent);
  const priority = new Map(priorityNames.map((name, index) => [name, index]));
  const remoteIndex = new Map(remote.map((candidate, index) => [candidate.id, index]));
  const candidates: T[] = [];

  for (const candidate of [...recent, ...remote]) {
    const existingIndex = candidates.findIndex((existing) =>
      isSameMentionCandidate(existing, candidate),
    );
    if (existingIndex === -1) {
      candidates.push(candidate);
    } else {
      candidates[existingIndex] = preferMentionCandidate(
        candidates[existingIndex],
        candidate,
      );
    }
  }

  return candidates
    .filter((candidate) => mentionCandidateMatches(candidate, term))
    .sort((left, right) => {
      const leftRecent = mentionCandidateIndexValue(recentIndexes, left);
      const rightRecent = mentionCandidateIndexValue(recentIndexes, right);
      if (leftRecent !== rightRecent) return leftRecent - rightRecent;

      const leftPriority =
        priority.get(normalizeMentionName(left.displayName)) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority =
        priority.get(normalizeMentionName(right.displayName)) ?? Number.MAX_SAFE_INTEGER;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;

      const leftStarts = mentionCandidateStartsWith(left, term) ? 0 : 1;
      const rightStarts = mentionCandidateStartsWith(right, term) ? 0 : 1;
      if (leftStarts !== rightStarts) return leftStarts - rightStarts;

      const leftRemote = remoteIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightRemote = remoteIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftRemote !== rightRemote) return leftRemote - rightRemote;

      return left.displayName.localeCompare(right.displayName);
    })
    .slice(0, 8);
}

function buildMentionCandidateIndex(
  candidates: MentionCandidate[],
): Map<string, number> {
  const index = new Map<string, number>();
  candidates.forEach((candidate, candidateIndex) => {
    for (const key of mentionCandidateIdentityKeys(candidate)) {
      if (!index.has(key)) index.set(key, candidateIndex);
    }
  });
  return index;
}

function mentionCandidateIndexValue(
  index: Map<string, number>,
  candidate: MentionCandidate,
): number {
  let best = Number.MAX_SAFE_INTEGER;
  for (const key of mentionCandidateIdentityKeys(candidate)) {
    best = Math.min(best, index.get(key) ?? Number.MAX_SAFE_INTEGER);
  }
  return best;
}

function mentionCandidateIdentityKeys(candidate: MentionCandidate): string[] {
  return [candidate.id, candidate.uniqueName]
    .map(normalizeMentionName)
    .filter((key): key is string => Boolean(key));
}

function isSameMentionCandidate(
  left: MentionCandidate,
  right: MentionCandidate,
): boolean {
  if (
    normalizedEquals(left.id, right.id) ||
    normalizedEquals(left.uniqueName, right.uniqueName)
  ) {
    return true;
  }
  // Two candidates with distinct unique names are provably different people,
  // even when they share a display name (namesakes).
  if (bothUniqueNamesDiffer(left.uniqueName, right.uniqueName)) {
    return false;
  }
  return (
    normalizedEquals(left.displayName, right.displayName) ||
    normalizedEquals(left.displayName, right.uniqueName) ||
    normalizedEquals(left.uniqueName, right.displayName)
  );
}

function bothUniqueNamesDiffer(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const normalizedLeft = normalizeMentionName(left);
  const normalizedRight = normalizeMentionName(right);
  return !!normalizedLeft && !!normalizedRight && normalizedLeft !== normalizedRight;
}

function preferMentionCandidate<T extends MentionCandidate>(left: T, right: T): T {
  const preferred =
    mentionCandidateDisplayScore(right) > mentionCandidateDisplayScore(left)
      ? right
      : left;
  return {
    ...preferred,
    uniqueName: preferred.uniqueName ?? left.uniqueName ?? right.uniqueName,
  };
}

function mentionCandidateDisplayScore(candidate: MentionCandidate): number {
  if (isEmailLikeDisplay(candidate.displayName)) return 0;
  if (candidate.uniqueName) return 2;
  return 1;
}

function normalizedEquals(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const normalizedLeft = normalizeMentionName(left);
  const normalizedRight = normalizeMentionName(right);
  return !!normalizedLeft && normalizedLeft === normalizedRight;
}

function isEmailLikeDisplay(value: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+$/.test(value.trim());
}

function isAzureDevOpsServiceIdentityName(
  displayName: string,
  uniqueName: string | null | undefined,
): boolean {
  const normalizedDisplayName = displayName.toLowerCase();
  const normalizedUniqueName = uniqueName?.toLowerCase();
  return (
    normalizedDisplayName.includes(" build service (") ||
    normalizedDisplayName.startsWith("agent pool service") ||
    (normalizedUniqueName?.startsWith("build\\") ?? false) ||
    (normalizedUniqueName?.startsWith("agentpool\\") ?? false) ||
    normalizedUniqueName === "project collection build service"
  );
}

function mentionCandidateMatches(candidate: MentionCandidate, term: string): boolean {
  if (!term) return true;
  return (
    candidate.displayName.toLowerCase().includes(term) ||
    (candidate.uniqueName?.toLowerCase().includes(term) ?? false)
  );
}

function mentionCandidateStartsWith(candidate: MentionCandidate, term: string): boolean {
  if (!term) return true;
  return (
    candidate.displayName.toLowerCase().startsWith(term) ||
    (candidate.uniqueName?.toLowerCase().startsWith(term) ?? false)
  );
}

function uniqueNormalizedNames(values: Array<string | null | undefined>): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeMentionName(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    names.push(normalized);
  }
  return names;
}

function normalizeMentionName(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

type SelectedMention = {
  id: string;
  displayName: string;
  uniqueName: string | null;
};

export function activeMentionAt(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const beforeCursor = text.slice(0, cursor);
  // Allow one internal space so "姓 名" style full names remain searchable.
  // The second word needs at least one character so a trailing space (as
  // inserted right after applying a mention) closes the picker.
  const match = /(^|\s)@([^\s@<>]{1,40}(?: [^\s@<>]{1,40})?|)$/.exec(beforeCursor);
  if (!match) return null;
  return {
    start: beforeCursor.length - (match[2].length + 1),
    query: match[2],
  };
}

function addSelectedMention(
  mentions: SelectedMention[],
  candidate: MentionCandidate,
): SelectedMention[] {
  if (mentions.some((mention) => mention.id === candidate.id)) {
    return mentions;
  }
  return [
    ...mentions,
    { id: candidate.id, displayName: candidate.displayName, uniqueName: candidate.uniqueName },
  ];
}

// Azure DevOps only resolves @<id> markdown mentions for storage-key GUIDs;
// any other token is silently dropped from the posted comment. Keeping the
// plain "@Name" text is strictly better than losing it.
const MENTION_RESOLVABLE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isMentionResolvableId(id: string): boolean {
  return MENTION_RESOLVABLE_ID_PATTERN.test(id);
}

export function renderAzureMentionMarkdown(
  text: string,
  mentions: SelectedMention[],
): string {
  let markdown = text;
  const sorted = [...mentions].sort(
    (a, b) => b.displayName.length - a.displayName.length,
  );
  for (const mention of sorted) {
    if (!isMentionResolvableId(mention.id)) continue;
    markdown = markdown.replace(
      mentionTokenPattern(mention.displayName),
      `@<${mention.id}>`,
    );
  }
  return markdown;
}

// Boundary: the next char must not extend a Latin word, so "@Tom" never
// matches inside "@Tomato", while punctuation and CJK text ("@田中さん",
// "@Alice,") still terminate the mention.
function mentionTokenPattern(displayName: string): RegExp {
  return new RegExp(`@${escapeRegExp(displayName)}(?=$|[^A-Za-z0-9_])`, "g");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
