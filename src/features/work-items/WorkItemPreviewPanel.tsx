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
import { Loader2, Send, Trash2 } from 'lucide-react';
import {
  addWorkItemComment,
  assignWorkItem,
  deleteWorkItemComment,
  fetchWorkItemImage,
  setWorkItemState,
  setWorkItemPriority,
  listWorkItemTypeStates,
  searchWorkItemMentions,
  commandErrorMessage,
  type MentionCandidate,
  type WorkItemPreview,
  type WorkItemSummary,
} from '@/lib/azdoCommands';
import { formatRelativeDate, isEditableTarget } from '@/lib/utils';
import { PreviewEmptyState } from '@/components/StateDisplay';
import { ShortcutHint } from '@/components/ShortcutHint';
import { invalidateWorkItemQueryViews, workItemQueryKeys } from './queryKeys';
const SAVED_REPLIES_STORAGE_KEY = "azdodeck:workItems:savedReplies";

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
  focusCommentRequest,
  openAssigneeRequest,
  openPriorityRequest,
  openStateRequest,
  preview,
  previewError,
  previewLoading,
  selectedItem,
  onPreviewUpdated,
}: {
  focusCommentRequest?: number;
  openAssigneeRequest?: number;
  openPriorityRequest?: number;
  openStateRequest?: number;
  preview: WorkItemPreview | null;
  previewError: string | null;
  previewLoading: boolean;
  selectedItem: WorkItemSummary | null;
  onPreviewUpdated?: (preview: WorkItemPreview) => void;
}) {
  const [commentText, setCommentText] = useState("");
  const [savedReplies, setSavedReplies] = useState<string[]>(() => loadSavedReplies());
  const [selectedMentions, setSelectedMentions] = useState<SelectedMention[]>([]);
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
  const recentMentionOptions = useMemo(
    () => recentWorkItemMentionCandidates(preview),
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
      mentionQuery,
    ),
    queryFn: () =>
      searchWorkItemMentions({
        organizationId: selectedItem?.organizationId,
        query: mentionQuery,
      }),
    enabled: !!selectedItem && mentionStart !== null && mentionQuery.length > 0,
    staleTime: 60_000,
  });
  const mentionOptions = useMemo(
    () =>
      rankMentionCandidates({
        recent: recentMentionOptions,
        remote: mentionOptionsQuery.data ?? [],
        query: mentionQuery,
        priorityNames: mentionPriorityNames,
      }),
    [
      mentionOptionsQuery.data,
      mentionPriorityNames,
      mentionQuery,
      recentMentionOptions,
    ],
  );
  const showMentionOptions = mentionStart !== null && mentionOptions.length > 0;
  const mentionPickerRef = useCloseOnOutsidePointer<HTMLDivElement>(
    showMentionOptions,
    () => {
      setMentionStart(null);
      setMentionQuery("");
    },
  );

  const assigneeOptionsQuery = useQuery({
    queryKey: workItemQueryKeys.assignees(
      selectedItem?.organizationId,
      assigneeQuery,
    ),
    queryFn: () =>
      searchWorkItemMentions({
        organizationId: selectedItem?.organizationId,
        query: assigneeQuery,
      }),
    enabled: !!selectedItem && assigneeOpen && assigneeQuery.trim().length > 0,
    staleTime: 60_000,
  });
  const assigneeOptions = useMemo(
    () =>
      rankMentionCandidates({
        recent: recentMentionOptions,
        remote: assigneeOptionsQuery.data ?? [],
        query: assigneeQuery,
        priorityNames: mentionPriorityNames,
      }),
    [
      assigneeOptionsQuery.data,
      assigneeQuery,
      mentionPriorityNames,
      recentMentionOptions,
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
      void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.myItemsRoot() });
      invalidateWorkItemQueryViews(queryClient);
    },
  });

  useEffect(() => {
    setAssigneeOpen(false);
    setAssigneeQuery("");
    setStatePickerOpen(false);
    setPriorityPickerOpen(false);
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

  function assignTo(candidate: MentionCandidate) {
    if (!selectedItem) return;
    assignMutation.mutate({
      organizationId: selectedItem.organizationId,
      projectId: selectedItem.projectId,
      workItemId: selectedItem.id,
      assignedTo: candidate.uniqueName ?? candidate.displayName,
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
      setPriorityPickerOpen(false);
    }
    function openAssignee() {
      if (!selectedItem) return;
      setAssigneeOpen(true);
      setStatePickerOpen(false);
      setPriorityPickerOpen(false);
      setAssigneeQuery("");
    }
    function openPriority() {
      if (!selectedItem) return;
      setPriorityPickerOpen(true);
      setAssigneeOpen(false);
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
      setPriorityPickerOpen(false);
    } else if (event.key === "a" || event.key === "A") {
      event.preventDefault();
      setAssigneeOpen(true);
      setStatePickerOpen(false);
      setPriorityPickerOpen(false);
      setAssigneeQuery("");
    } else if (event.key === "p" || event.key === "P") {
      event.preventDefault();
      setPriorityPickerOpen(true);
      setAssigneeOpen(false);
      setStatePickerOpen(false);
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
      className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-white shadow-sm"
      onKeyDown={handlePreviewPanelKeyDown}
    >
      {!selectedItem ? (
        <PreviewEmptyState message="Select a work item." />
      ) : (
        <>
          <div className="border-b border-border bg-gradient-to-b from-slate-50 to-white px-3 py-2">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="shrink-0 font-mono text-[11px] font-semibold text-muted-foreground">
                    #{selectedItem.id}
                  </span>
                  {(preview?.workItemType ?? selectedItem.workItemType) ? (
                    <WorkItemBadge tone="type">
                      {preview?.workItemType ?? selectedItem.workItemType}
                    </WorkItemBadge>
                  ) : null}
                  {(preview?.state ?? selectedItem.state) ? (
                    <WorkItemBadge tone={stateBadgeTone(preview?.state ?? selectedItem.state)}>
                      {preview?.state ?? selectedItem.state}
                    </WorkItemBadge>
                  ) : null}
                  <span
                    className="min-w-0 truncate text-[11px] text-muted-foreground"
                    title={selectedItem.projectName}
                  >
                    {selectedItem.projectName}
                  </span>
                </div>
                <h2 className="mt-1 line-clamp-2 text-[15px] font-semibold leading-5 text-foreground" title={selectedItem.title}>
                  {selectedItem.title}
                </h2>
              </div>
              {previewLoading ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
              ) : (
                <ShortcutHint>Alt+P</ShortcutHint>
              )}
            </div>
          </div>
          {previewError ? (
            <div className="m-3 rounded-md border border-destructive/30 bg-red-50 p-3 text-sm text-destructive">
              {previewError}
            </div>
          ) : preview ? (
            <>
              <WorkItemPreviewDetails
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
                onDeleteComment={deleteComment}
                preview={preview}
                priorityControl={
                  <PriorityPicker
                    current={preview.priority}
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
                      assigneeOptionsQuery.isError
                        ? commandErrorMessage(assigneeOptionsQuery.error)
                        : null
                    }
                    loading={assigneeOptionsQuery.isFetching}
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
              <div className="border-t border-border bg-slate-50/70 p-2">
                <form className="space-y-1.5" onSubmit={submitComment}>
                  <div className="grid gap-1">
                    <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                      <span>Comment</span>
                      <span className="flex items-center gap-1">
                        <ShortcutHint>Alt+M</ShortcutHint>
                        <ShortcutHint>Ctrl+Enter</ShortcutHint>
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1">
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
                    </span>
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
                        rows={2}
                        className="min-h-[42px] w-full resize-none rounded-md border border-input bg-white px-2 py-1.5 text-sm outline-none transition-[min-height] focus:min-h-[72px] focus:ring-2 focus:ring-ring"
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
                      ) : null}
                    </div>
                  </div>
                  {commentMutation.isError ? (
                    <p className="text-xs text-destructive">
                      {commandErrorMessage(commentMutation.error)}
                    </p>
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="submit"
                      disabled={!commentText.trim() || commentMutation.isPending}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {commentMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Send className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      Post comment
                    </button>
                    {commentMutation.isSuccess ? (
                      <span className="text-xs text-muted-foreground">Comment posted</span>
                    ) : null}
                  </div>
                </form>
              </div>
            </>
          ) : (
            <PreviewEmptyState message={`Loading work item #${selectedItem.id}.`} />
          )}
        </>
      )}
    </aside>
  );
}

function WorkItemPreviewDetails({
  preview,
  assigneeControl,
  deleteCommentError,
  deletingCommentId,
  deletePending,
  mentionDisplayNames,
  onDeleteComment,
  priorityControl,
  resolveImageSource,
  stateControl,
}: {
  preview: WorkItemPreview;
  assigneeControl: ReactNode;
  deleteCommentError: string | null;
  deletingCommentId: number | null;
  deletePending: boolean;
  mentionDisplayNames: ReadonlyMap<string, string>;
  onDeleteComment: (commentId: number) => void;
  priorityControl: ReactNode;
  resolveImageSource: (url: string) => Promise<string | null>;
  stateControl: ReactNode;
}) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const fields = [
    ["Area", preview.areaPath],
    ["Iteration", preview.iterationPath],
    ["Reason", preview.reason],
    ["Severity", preview.severity],
    ["Points", preview.storyPoints],
    ["Remain", preview.remainingWork],
    ["Tags", preview.tags],
  ].filter(([, value]) => !!value);

  const descriptionHtml = normalizeRichHtml(preview.descriptionHtml);
  const acceptanceCriteriaHtml = normalizeRichHtml(preview.acceptanceCriteriaHtml);

  return (
    <div
      aria-keyshortcuts="Alt+P"
      aria-label="Work item preview"
      className="min-h-0 flex-1 overflow-auto bg-white px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-inset focus:ring-ring"
      data-primary-preview="true"
      onKeyDown={stopPreviewNavigationKeyDown}
      tabIndex={-1}
    >
      <div className="rounded-md border border-border bg-slate-50/50 px-2 py-1">
        <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-x-2 gap-y-0.5 border-b border-border/70 pb-1">
          <PreviewControl label="State" shortcut="S">
            {stateControl}
          </PreviewControl>
          <PreviewControl label="Assigned" shortcut="A">
            {assigneeControl}
          </PreviewControl>
          <PreviewControl label="Priority" shortcut="P">
            {priorityControl}
          </PreviewControl>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-x-2 gap-y-0.5 pt-1">
          {fields.length > 0
            ? fields.map(([label, value]) => (
                <PreviewField
                  key={label ?? ""}
                  label={label ?? ""}
                  value={value ?? ""}
                />
              ))
            : null}
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
    <article className="min-w-0 overflow-hidden rounded-md border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex min-w-0 items-center gap-1.5 border-b border-border bg-slate-50 px-2 py-1.5">
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
          className="ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-transparent text-muted-foreground hover:border-border hover:bg-white hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60"
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
      <div className="px-2.5 py-2">
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

function WorkItemBadge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "type" | "neutral" | "green" | "amber" | "blue";
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "blue"
          ? "border-blue-200 bg-blue-50 text-blue-700"
          : tone === "type"
            ? "border-slate-300 bg-white text-slate-700"
            : "border-border bg-white text-muted-foreground";
  return (
    <span
      className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none ${toneClass}`}
    >
      {children}
    </span>
  );
}

function stateBadgeTone(state: string | null | undefined): "neutral" | "green" | "amber" | "blue" {
  const normalized = state?.toLowerCase() ?? "";
  if (/(done|closed|resolved|completed|removed)/.test(normalized)) return "green";
  if (/(blocked|new|to do|todo|proposed)/.test(normalized)) return "amber";
  if (/(active|doing|progress|committed)/.test(normalized)) return "blue";
  return "neutral";
}

function PreviewControl({
  children,
  label,
  shortcut,
}: {
  children: ReactNode;
  label: string;
  shortcut: string;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-1">
      <span className="truncate text-[10px] font-semibold uppercase leading-4 text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 items-center leading-4">{children}</div>
      <ShortcutHint>{shortcut}</ShortcutHint>
    </div>
  );
}

function PreviewField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[44px_minmax(0,1fr)] items-baseline gap-1">
      <dt className="truncate text-[10px] leading-4 text-muted-foreground">{label}</dt>
      <dd className="truncate text-[12px] font-semibold leading-4 text-foreground" title={value}>
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
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-[10px] font-semibold uppercase leading-3 tracking-normal text-muted-foreground">
          {title}
        </h3>
        <div className="h-px min-w-0 flex-1 bg-border" />
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
  const fontSize = density === "comfortable" ? 13 : 12;
  const lineHeight = density === "comfortable" ? 1.45 : 1.35;
  const paragraphMargin = density === "comfortable" ? 8 : 6;
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
    ul, ol { margin: 0 0 6px 18px; padding: 0; }
    li { margin: 1px 0; }
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
    table { width: 100%; margin: 0 0 6px; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #dbe3ef; padding: 3px 5px; text-align: left; vertical-align: top; }
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
  if (htmlToText(html) || /<(img|video|table|pre|blockquote|ul|ol|li|a)\b/i.test(html)) {
    return html;
  }
  return null;
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
    escapeHtml(plain) ??
    "No text"
  );
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

function StatePicker({
  current,
  loading,
  onOpenChange,
  onSelect,
  open,
  options,
  pending,
  shortcut,
}: {
  current: string | null;
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

  return (
    <div ref={pickerRef} className="relative min-w-0">
      <button
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
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 min-w-[120px] rounded-md border border-border bg-white py-1 shadow-lg">
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
  onOpenChange,
  onSelect,
  open,
  pending,
  shortcut,
}: {
  current: string | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (priority: number) => void;
  open: boolean;
  pending: boolean;
  shortcut?: string;
}) {
  const pickerRef = useCloseOnOutsidePointer<HTMLDivElement>(open, () =>
    onOpenChange(false),
  );
  const options = [1, 2, 3, 4];

  return (
    <div ref={pickerRef} className="relative min-w-0">
      <button
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
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 min-w-[96px] rounded-md border border-border bg-white py-1 shadow-lg">
          {options.map((priority, index) => {
            const value = String(priority);
            return (
              <button
                key={priority}
                type="button"
                autoFocus={index === 0}
                onClick={() => onSelect(priority)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    onOpenChange(false);
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
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  onSelect: (candidate: MentionCandidate) => void;
  open: boolean;
  options: MentionCandidate[];
  pending: boolean;
  query: string;
  shortcut?: string;
}) {
  const pickerRef = useCloseOnOutsidePointer<HTMLDivElement>(open, () =>
    onOpenChange(false),
  );

  return (
    <div ref={pickerRef} className="relative min-w-0">
      <button
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
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-md border border-border bg-white p-1 shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onOpenChange(false);
              }
            }}
            placeholder="Search assignee..."
            className="mb-1 h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="max-h-44 overflow-auto">
            {error && query.trim() ? (
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

function htmlToText(value: string | null | undefined): string {
  if (!value) return "";
  if (typeof document === "undefined") {
    return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  const element = document.createElement("div");
  element.innerHTML = value;
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function recentWorkItemMentionCandidates(
  preview: WorkItemPreview | null,
): MentionCandidate[] {
  if (!preview) return [];
  const candidates = new Map<string, MentionCandidate>();
  for (const comment of preview.comments) {
    if (!comment.createdById || !comment.createdBy) continue;
    candidates.set(comment.createdById, {
      id: comment.createdById,
      displayName: comment.createdBy,
      uniqueName: comment.createdByUniqueName ?? null,
    });
  }
  return [...candidates.values()];
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

function rankMentionCandidates({
  recent,
  remote,
  query,
  priorityNames,
}: {
  recent: MentionCandidate[];
  remote: MentionCandidate[];
  query: string;
  priorityNames: string[];
}): MentionCandidate[] {
  const term = query.trim().toLowerCase();
  const recentIds = new Map(recent.map((candidate, index) => [candidate.id, index]));
  const priority = new Map(priorityNames.map((name, index) => [name, index]));
  const candidates = new Map<string, MentionCandidate>();

  for (const candidate of [...recent, ...remote]) {
    const key = candidate.id || candidate.uniqueName || candidate.displayName;
    if (!candidates.has(key)) {
      candidates.set(key, candidate);
    }
  }

  return [...candidates.values()]
    .filter((candidate) => mentionCandidateMatches(candidate, term))
    .sort((left, right) => {
      const leftRecent = recentIds.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightRecent = recentIds.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftRecent !== rightRecent) return leftRecent - rightRecent;

      const leftPriority =
        priority.get(normalizeMentionName(left.displayName)) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority =
        priority.get(normalizeMentionName(right.displayName)) ?? Number.MAX_SAFE_INTEGER;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;

      const leftStarts = mentionCandidateStartsWith(left, term) ? 0 : 1;
      const rightStarts = mentionCandidateStartsWith(right, term) ? 0 : 1;
      if (leftStarts !== rightStarts) return leftStarts - rightStarts;

      return left.displayName.localeCompare(right.displayName);
    })
    .slice(0, 8);
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
};

function activeMentionAt(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const beforeCursor = text.slice(0, cursor);
  const match = /(^|\s)@([^\s@<>]{0,40})$/.exec(beforeCursor);
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
    { id: candidate.id, displayName: candidate.displayName },
  ];
}

function renderAzureMentionMarkdown(
  text: string,
  mentions: SelectedMention[],
): string {
  let markdown = text;
  for (const mention of mentions) {
    markdown = markdown.replace(
      new RegExp(`@${escapeRegExp(mention.displayName)}(?=\\s|$)`, "g"),
      `@<${mention.id}>`,
    );
  }
  return markdown;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
