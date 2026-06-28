import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  commandErrorMessage,
  deletePullRequestComment,
  editPullRequestComment,
  postPullRequestComment,
  prLocator,
  setPullRequestThreadStatus,
  submitPullRequestVote,
  updatePullRequest,
  updatePullRequestDetails,
  type PullRequestAction,
  type ReviewPullRequestSummary,
} from "@/lib/azdoCommands";

export function usePrReviewActions(pr: ReviewPullRequestSummary) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  // Reset error state when another PR is selected.
  useEffect(() => {
    setActionError(null);
  }, [pr.pullRequestId, pr.repositoryId]);

  function invalidateReview() {
    void queryClient.invalidateQueries({
      queryKey: ["prReview", pr.organizationId, pr.repositoryId, pr.pullRequestId],
    });
    void queryClient.invalidateQueries({ queryKey: ["myReviews", pr.organizationId] });
  }

  const voteMutation = useMutation({
    mutationFn: submitPullRequestVote,
    onSuccess: () => { setActionError(null); invalidateReview(); },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const commentMutation = useMutation({
    mutationFn: postPullRequestComment,
    onSuccess: () => { setActionError(null); invalidateReview(); },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const statusMutation = useMutation({
    mutationFn: setPullRequestThreadStatus,
    onSuccess: () => { setActionError(null); invalidateReview(); },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const editMutation = useMutation({
    mutationFn: editPullRequestComment,
    onSuccess: () => { setActionError(null); invalidateReview(); },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const deleteMutation = useMutation({
    mutationFn: deletePullRequestComment,
    onSuccess: () => { setActionError(null); invalidateReview(); },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const [mergeStrategy, setMergeStrategy] = useState("squash");
  const [deleteSourceBranch, setDeleteSourceBranch] = useState(false);
  const [transitionWorkItems, setTransitionWorkItems] = useState(false);

  const updateMutation = useMutation({
    mutationFn: updatePullRequest,
    onSuccess: () => { setActionError(null); invalidateReview(); },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const [editingDetails, setEditingDetails] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");

  const detailsMutation = useMutation({
    mutationFn: updatePullRequestDetails,
    onSuccess: () => {
      setActionError(null);
      setEditingDetails(false);
      invalidateReview();
    },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  function startEditingDetails(currentTitle: string, currentDescription: string) {
    setDraftTitle(currentTitle);
    setDraftDescription(currentDescription);
    setActionError(null);
    setEditingDetails(true);
  }

  function saveDetails() {
    if (!draftTitle.trim()) return;
    detailsMutation.mutate({
      ...prLocator(pr),
      title: draftTitle.trim(),
      description: draftDescription,
    });
  }

  function runPrAction(action: PullRequestAction, confirmMessage: string) {
    if (!window.confirm(confirmMessage)) return;
    updateMutation.mutate({
      ...prLocator(pr),
      action,
      ...(action === "complete" || action === "enableAutoComplete"
        ? {
            mergeStrategy,
            deleteSourceBranch,
            ...(action === "complete" ? { transitionWorkItems } : {}),
          }
        : {}),
    });
  }

  return {
    actionError,
    voteMutation,
    commentMutation,
    statusMutation,
    editMutation,
    deleteMutation,
    updateMutation,
    detailsMutation,
    mergeStrategy,
    setMergeStrategy,
    deleteSourceBranch,
    setDeleteSourceBranch,
    transitionWorkItems,
    setTransitionWorkItems,
    editingDetails,
    setEditingDetails,
    draftTitle,
    setDraftTitle,
    draftDescription,
    setDraftDescription,
    startEditingDetails,
    saveDetails,
    runPrAction,
  };
}
