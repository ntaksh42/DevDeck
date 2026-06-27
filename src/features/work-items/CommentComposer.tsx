import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import {
  addWorkItemComment,
  commandErrorMessage,
  recordMentionInteraction,
  searchWorkItemMentions,
  type MentionCandidate,
  type Organization,
  type WorkItemSummary,
} from "@/lib/azdoCommands";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { workItemQueryKeys } from "./queryKeys";
import {
  activeMentionAt,
  addSelectedMention,
  isMentionResolvableId,
  markdownWithHardLineBreaks,
  mentionTokenDeletionStart,
  mentionTokenPattern,
  rankMentionCandidates,
  renderAzureMentionMarkdown,
  scrollMentionOptionIntoView,
  sortSelfLast,
  type SelectedMention,
} from "./workItemMentions";
import { CandidateAvatar, HighlightedText, useCloseOnOutsidePointer } from "./PreviewEditors";

// Owns the comment draft and the mention picker so typing re-renders only
// this subtree, not the whole preview panel with its comment iframes.
export function CommentComposer({
  focusCommentRequest,
  hasStagedChanges,
  mentionPriorityNames,
  onApplyStaged,
  onEscapeToPanel,
  onMentionApplied,
  recentMentionOptions,
  selectedItem,
  selfOrg,
}: {
  focusCommentRequest?: number;
  hasStagedChanges: boolean;
  mentionPriorityNames: string[];
  onApplyStaged: () => void;
  onEscapeToPanel: () => void;
  onMentionApplied: (candidate: MentionCandidate) => void;
  recentMentionOptions: MentionCandidate[];
  selectedItem: WorkItemSummary | null;
  selfOrg: Organization | undefined;
}) {
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState("");
  const [selectedMentions, setSelectedMentions] = useState<SelectedMention[]>([]);
  const mentionsToRecordRef = useRef<
    Array<{ id: string; displayName: string; uniqueName: string; organizationId: string }>
  >([]);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const handledFocusCommentRequest = useRef(0);

  // Debounced so each keystroke does not fire a backend identity search;
  // keepPreviousData keeps the list visible while the next search runs.
  const debouncedMentionQuery = useDebouncedValue(mentionQuery, 200);
  const mentionOptionsQuery = useQuery({
    queryKey: workItemQueryKeys.mentions(
      selectedItem?.organizationId,
      selectedItem?.projectId,
      selectedItem?.id,
      debouncedMentionQuery,
    ),
    queryFn: () =>
      searchWorkItemMentions({
        organizationId: selectedItem!.organizationId,
        projectId: selectedItem!.projectId,
        workItemId: selectedItem!.id,
        query: debouncedMentionQuery,
      }),
    enabled: !!selectedItem && mentionStart !== null,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const mentionOptions = useMemo(
    () =>
      // Self stays in the list but last: removing it entirely leaves the
      // picker empty in single-member organizations.
      sortSelfLast(
        rankMentionCandidates({
          recent: recentMentionOptions,
          remote: mentionOptionsQuery.data ?? [],
          query: mentionQuery,
          priorityNames: mentionPriorityNames,
        }),
        selfOrg,
      ),
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

  // Switching work items clears the unsent draft.
  useEffect(() => {
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
    function focusComment() {
      if (!selectedItem) return;
      textareaRef.current?.focus();
    }
    function submitCurrentComment() {
      postComment();
    }
    window.addEventListener("azdodeck:work-items:focus-comment", focusComment);
    window.addEventListener("azdodeck:work-items:post-comment", submitCurrentComment);
    return () => {
      window.removeEventListener("azdodeck:work-items:focus-comment", focusComment);
      window.removeEventListener("azdodeck:work-items:post-comment", submitCurrentComment);
    };
  });

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
    onMentionApplied(candidate);
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
      markdown: markdownWithHardLineBreaks(
        renderAzureMentionMarkdown(commentText, selectedMentions),
      ),
    });
  }

  function handleCommentKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      postComment();
      // One keystroke finishes the "comment + property change" flow, like
      // Azure DevOps' save-with-comment.
      if (hasStagedChanges) onApplyStaged();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      if (mentionStart !== null) {
        setMentionQuery("");
        setMentionStart(null);
      } else {
        // Second Esc backs out of the comment editor so the panel's
        // single-key shortcuts (s/a/p/r, Esc) work again.
        onEscapeToPanel();
      }
      return;
    }

    if (
      event.key === "Backspace" &&
      event.currentTarget.selectionStart === event.currentTarget.selectionEnd
    ) {
      const textarea = event.currentTarget;
      const cursor = textarea.selectionStart;
      const start = mentionTokenDeletionStart(
        commentText,
        cursor,
        selectedMentions.map((mention) => mention.displayName),
      );
      if (start !== null) {
        event.preventDefault();
        const next = commentText.slice(0, start) + commentText.slice(cursor);
        setCommentText(next);
        updateMentionState(next, start);
        window.setTimeout(() => textarea.setSelectionRange(start, start), 0);
        return;
      }
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
    }
  }

  function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    postComment();
  }

  return (
    <div className="bg-muted/70 p-2">
      <form className="space-y-1" onSubmit={submitComment}>
        <div ref={mentionPickerRef} className="relative">
          <textarea
            ref={textareaRef}
            data-work-item-comment-input="true"
            value={commentText}
            onChange={(event) => {
              setCommentText(event.target.value);
              updateMentionState(event.target.value, event.target.selectionStart);
            }}
            onClick={(event) => {
              updateMentionState(
                event.currentTarget.value,
                event.currentTarget.selectionStart,
              );
            }}
            onKeyDown={handleCommentKeyDown}
            aria-label="Comment"
            aria-keyshortcuts="M Control+M Control+Enter Meta+Enter"
            placeholder="Add a comment..."
            rows={2}
            className="min-h-[36px] w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none transition-[border-color,box-shadow,min-height] focus:min-h-[64px] focus:border-primary focus:ring-4 focus:ring-primary/20"
          />
          {showMentionOptions ? (
            <div className="absolute bottom-full left-0 z-20 mb-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-lg">
              {mentionOptions.map((candidate, index) => (
                <button
                  key={candidate.id}
                  type="button"
                  ref={
                    index === activeMentionIndex
                      ? scrollMentionOptionIntoView
                      : undefined
                  }
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyMention(candidate)}
                  className={`flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-sm ${
                    index === activeMentionIndex ? "bg-secondary" : "hover:bg-muted"
                  }`}
                >
                  <CandidateAvatar displayName={candidate.displayName} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      <HighlightedText text={candidate.displayName} query={mentionQuery} />
                    </span>
                    {candidate.uniqueName ? (
                      <span className="truncate text-xs text-muted-foreground">
                        <HighlightedText text={candidate.uniqueName} query={mentionQuery} />
                      </span>
                    ) : null}
                  </span>
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
        <div className="flex items-center justify-end gap-1.5">
          {commentMutation.isSuccess ? (
            <span className="text-xs text-muted-foreground">Comment posted</span>
          ) : null}
          <button
            type="submit"
            aria-label="Post comment"
            title="Post comment (Ctrl+Enter)"
            disabled={!commentText.trim() || commentMutation.isPending}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {commentMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

