import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  commandErrorMessage,
  deletePullRequestComment,
  editPullRequestComment,
  postPullRequestComment,
  prLocator,
  setPullRequestThreadStatus,
  type PrThread,
  type ReviewPullRequestSummary,
} from "@/lib/azdoCommands";
import type { CommentSide, DiffCommentDraft } from "./PrFilesTabTypes";

/**
 * Owns the comment/thread mutations for the PR Files tab: posting inline
 * comments, replying, resolving/reopening, editing, deleting. Extracted out of
 * PrFilesTab so that file stays focused on tree/scroll orchestration.
 */
export function usePrFileComments(pr: ReviewPullRequestSummary) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState<DiffCommentDraft | null>(null);

  // Reset draft/error state when switching PRs.
  useEffect(() => {
    setActionError(null);
    setCommentDraft(null);
  }, [pr.organizationId, pr.repositoryId, pr.pullRequestId]);

  function invalidateReview() {
    void queryClient.invalidateQueries({
      queryKey: ["prReview", pr.organizationId, pr.repositoryId, pr.pullRequestId],
    });
  }

  const commentMutation = useMutation({
    mutationFn: postPullRequestComment,
    onSuccess: () => {
      setActionError(null);
      setCommentDraft(null);
      invalidateReview();
    },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const statusMutation = useMutation({
    mutationFn: setPullRequestThreadStatus,
    onSuccess: () => {
      setActionError(null);
      invalidateReview();
    },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const editMutation = useMutation({
    mutationFn: editPullRequestComment,
    onSuccess: () => {
      setActionError(null);
      invalidateReview();
    },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const deleteMutation = useMutation({
    mutationFn: deletePullRequestComment,
    onSuccess: () => {
      setActionError(null);
      invalidateReview();
    },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const mutationsBusy =
    commentMutation.isPending ||
    statusMutation.isPending ||
    editMutation.isPending ||
    deleteMutation.isPending;

  function startComment(path: string, side: CommentSide, line: number) {
    setActionError(null);
    setCommentDraft({ path, side, line });
  }

  function cancelComment() {
    setCommentDraft(null);
  }

  function postInlineComment(content: string): Promise<void> {
    if (!commentDraft) return Promise.resolve();
    return commentMutation
      .mutateAsync({
        ...prLocator(pr),
        content,
        filePath: commentDraft.path,
        ...(commentDraft.side === "left"
          ? { leftLine: commentDraft.line }
          : { rightLine: commentDraft.line }),
      })
      .then(() => undefined);
  }

  function replyToThread(thread: PrThread, content: string): Promise<void> {
    return commentMutation
      .mutateAsync({ ...prLocator(pr), threadId: thread.id, content })
      .then(() => undefined);
  }

  function toggleThreadStatus(thread: PrThread) {
    statusMutation.mutate({
      ...prLocator(pr),
      threadId: thread.id,
      status: thread.isResolved ? "active" : "closed",
    });
  }

  function editComment(thread: PrThread, commentId: number, content: string): Promise<void> {
    return editMutation
      .mutateAsync({ ...prLocator(pr), threadId: thread.id, commentId, content })
      .then(() => undefined);
  }

  function deleteComment(thread: PrThread, commentId: number): Promise<void> {
    return deleteMutation.mutateAsync({ ...prLocator(pr), threadId: thread.id, commentId });
  }

  return {
    actionError,
    setActionError,
    commentDraft,
    mutationsBusy,
    commentMutation,
    startComment,
    cancelComment,
    postInlineComment,
    replyToThread,
    toggleThreadStatus,
    editComment,
    deleteComment,
  };
}
