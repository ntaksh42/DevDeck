import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import {
  addWorkItemComment,
  commandErrorMessage,
  recordMentionInteraction,
  type MentionCandidate,
  type Organization,
  type WorkItemSummary,
} from "@/lib/azdoCommands";
import {
  usePersistedTextareaHeight,
  WORK_ITEM_COMMENT_HEIGHT_STORAGE_KEY,
} from "@/lib/usePersistedTextareaHeight";
import { workItemQueryKeys } from "./queryKeys";
import {
  isMentionResolvableId,
  markdownWithHardLineBreaks,
  mentionTokenPattern,
  renderAzureMentionMarkdown,
} from "./workItemMentions";
import { useWorkItemMentionPicker } from "./useWorkItemMentionPicker";
import { MentionPickerDropdown } from "./MentionPickerDropdown";

// Owns the comment draft and drives the shared mention picker so typing
// re-renders only this subtree, not the whole preview panel with its comment
// iframes.
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
  const mentionsToRecordRef = useRef<
    Array<{ id: string; displayName: string; uniqueName: string; organizationId: string }>
  >([]);
  const textareaRef = usePersistedTextareaHeight(
    WORK_ITEM_COMMENT_HEIGHT_STORAGE_KEY,
  );
  const handledFocusCommentRequest = useRef(0);

  const mentionPicker = useWorkItemMentionPicker({
    value: commentText,
    setValue: setCommentText,
    textareaRef,
    scope: selectedItem,
    recentMentionOptions,
    mentionPriorityNames,
    selfOrg,
    onMentionApplied,
  });

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
      mentionPicker.resetMentions();
      void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.previewRoot() });
    },
  });

  // Switching work items clears the unsent draft.
  useEffect(() => {
    setCommentText("");
    mentionPicker.resetMentions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function postComment(): boolean {
    if (!selectedItem || !commentText.trim() || commentMutation.isPending) return false;
    mentionsToRecordRef.current = mentionPicker.selectedMentions
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
        renderAzureMentionMarkdown(commentText, mentionPicker.selectedMentions),
      ),
    });
    return true;
  }

  function handleCommentKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      const posted = postComment();
      // One keystroke finishes the "comment + property change" flow, like
      // Azure DevOps' save-with-comment.
      if (hasStagedChanges) onApplyStaged();
      // Submitting ends the editing session: hand focus back to the panel so
      // its single-key shortcuts and row navigation resume immediately.
      if (posted || hasStagedChanges) onEscapeToPanel();
      return;
    }

    // The mention picker consumes its own navigation/close keys; anything it
    // does not handle (a second Escape included) falls through to the panel.
    if (mentionPicker.handleKeyDown(event)) return;

    if (event.key === "Escape") {
      event.preventDefault();
      onEscapeToPanel();
    }
  }

  function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    postComment();
  }

  return (
    <div className="bg-muted/70 p-2">
      <form className="space-y-1" onSubmit={submitComment}>
        <div ref={mentionPicker.containerRef} className="relative">
          <textarea
            ref={textareaRef}
            data-work-item-comment-input="true"
            value={commentText}
            onChange={(event) => {
              setCommentText(event.target.value);
              mentionPicker.handleTextChange(event.target.value, event.target.selectionStart);
            }}
            onClick={(event) => {
              mentionPicker.handleSelectionChange(event.currentTarget.selectionStart);
            }}
            onKeyDown={handleCommentKeyDown}
            aria-label="Comment"
            aria-keyshortcuts="M Control+M Control+Enter Meta+Enter"
            placeholder="Add a comment..."
            rows={2}
            className="min-h-[36px] w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none transition-[border-color,box-shadow,min-height] focus:min-h-[64px] focus:border-primary focus:ring-4 focus:ring-primary/20"
          />
          <MentionPickerDropdown
            options={mentionPicker.dropdown.options}
            activeIndex={mentionPicker.dropdown.activeIndex}
            query={mentionPicker.dropdown.query}
            errorMessage={mentionPicker.dropdown.errorMessage}
            onSelect={mentionPicker.applyMention}
          />
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
