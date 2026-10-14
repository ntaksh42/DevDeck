import { useEffect, useRef, useState } from "react";
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
  type PrLocatorInput,
  type PullRequestAction,
  type ReviewPullRequestSummary,
} from "@/lib/azdoCommands";
import { useConfirm } from "@/components/ConfirmDialog";
import { recordUsage } from "@/lib/usageStats";
import { useExperimentalFlags } from "@/features/settings/useExperimentalFlags";

export function usePrReviewActions(pr: ReviewPullRequestSummary) {
  const queryClient = useQueryClient();
  const experimental = useExperimentalFlags();
  const [actionError, setActionError] = useState<string | null>(null);

  const [editingDetails, setEditingDetails] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");

  // Another PR selected: drop the error and any title/description edit, which
  // would otherwise be saved onto the newly selected PR.
  const prKey = `${pr.organizationId}:${pr.repositoryId}:${pr.pullRequestId}`;
  const currentKey = useRef(prKey);
  currentKey.current = prKey;
  useEffect(() => {
    setActionError(null);
    setEditingDetails(false);
  }, [prKey]);

  /** Refreshes the PR a mutation ran on, which may no longer be the selected one. */
  function invalidateReview(target: PrLocatorInput) {
    void queryClient.invalidateQueries({
      queryKey: ["prReview", target.organizationId, target.repositoryId, target.pullRequestId],
    });
    void queryClient.invalidateQueries({ queryKey: ["myReviews", target.organizationId] });
    void queryClient.invalidateQueries({ queryKey: ["myCreatedPullRequests", target.organizationId] });
  }

  /** A failure is shown only while the PR it happened on is still selected. */
  function showError(mutationError: unknown, target: PrLocatorInput) {
    if (`${target.organizationId}:${target.repositoryId}:${target.pullRequestId}` !== currentKey.current) return;
    setActionError(commandErrorMessage(mutationError));
  }

  const voteMutation = useMutation({
    mutationFn: submitPullRequestVote,
    onSuccess: (_data, variables) => { setActionError(null); invalidateReview(variables); },
    onError: showError,
  });

  const commentMutation = useMutation({
    mutationFn: postPullRequestComment,
    onSuccess: (_data, variables) => { setActionError(null); invalidateReview(variables); },
    onError: showError,
  });

  const statusMutation = useMutation({
    mutationFn: setPullRequestThreadStatus,
    onSuccess: (_data, variables) => {
      // Only closing a thread counts as resolving one; reopening does not.
      if (variables.status === "closed") {
        recordUsage("resolvedThreads", experimental.usageStats);
      }
      setActionError(null);
      invalidateReview(variables);
    },
    onError: showError,
  });

  const editMutation = useMutation({
    mutationFn: editPullRequestComment,
    onSuccess: (_data, variables) => { setActionError(null); invalidateReview(variables); },
    onError: showError,
  });

  const deleteMutation = useMutation({
    mutationFn: deletePullRequestComment,
    onSuccess: (_data, variables) => { setActionError(null); invalidateReview(variables); },
    onError: showError,
  });

  const [mergeStrategy, setMergeStrategy] = useState("squash");
  const [deleteSourceBranch, setDeleteSourceBranch] = useState(false);
  const [transitionWorkItems, setTransitionWorkItems] = useState(false);

  const updateMutation = useMutation({
    mutationFn: updatePullRequest,
    onSuccess: (_data, variables) => { setActionError(null); invalidateReview(variables); },
    onError: showError,
  });

  const detailsMutation = useMutation({
    mutationFn: updatePullRequestDetails,
    onSuccess: (_data, variables) => {
      setActionError(null);
      setEditingDetails(false);
      invalidateReview(variables);
    },
    onError: showError,
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

  const { confirm, dialogProps: confirmDialogProps } = useConfirm();

  function runPrAction(action: PullRequestAction, confirmMessage: string) {
    confirm({
      title: "Confirm",
      message: confirmMessage,
      destructive: action === "abandon",
      onConfirm: () =>
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
        }),
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
    confirmDialogProps,
  };
}
