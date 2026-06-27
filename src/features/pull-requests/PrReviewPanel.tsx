import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Loader2, Pencil, X } from "lucide-react";
import {
  commandErrorMessage,
  deletePullRequestComment,
  editPullRequestComment,
  getAppSettings,
  getPullRequestReview,
  updatePullRequestDetails,
  getReviewResultPreview,
  listPullRequestCommits,
  postPullRequestComment,
  prLocator,
  removePullRequestReviewer,
  searchPullRequestMentions,
  setPullRequestReviewerRequired,
  setPullRequestThreadStatus,
  submitPullRequestVote,
  updatePullRequest,
  type MentionCandidate,
  type PullRequestAction,
  type PullRequestReview,
  type ReviewPullRequestSummary,
} from "@/lib/azdoCommands";
import { focusPrimaryGrid, formatDate, formatRelativeDate, isEditableTarget } from "@/lib/utils";
import { extractWorkItemMentions, navigateToWorkItem } from "@/lib/crossLinks";
import { MarkdownView } from "@/lib/markdown";
import { openExternalUrl, openLocalPath } from "@/lib/openExternal";
import { LoadingState, ErrorState, PreviewEmptyState } from "@/components/StateDisplay";
import { CommentComposer } from "./CommentComposer";
// The Files tab is not the default tab and pulls in the `diff` library, so it
// is code-split to keep that weight out of the startup bundle.
const PrFilesTab = lazy(() =>
  import("./PrFilesTab").then((m) => ({ default: m.PrFilesTab })),
);
import { PrThreadCard } from "./PrThreadCard";
import { PrReviewHeader } from "./PrReviewHeader";
import { PrPreviewSection } from "./PrPreviewSection";
import { PrOverflowMenu } from "./PrOverflowMenu";
import { VOTE_BADGE_CLASSES, voteTone } from "./voteVisual";

function usePrMentionSearch(organizationId: string) {
  return useCallback(
    (query: string): Promise<MentionCandidate[]> =>
      searchPullRequestMentions({ organizationId, query }),
    [organizationId],
  );
}

type PanelTab = "review" | "files" | "commits" | "result";

// Order/labels mirror GitHub's PR tabs (Conversation, Commits, Files changed).
const PANEL_TABS: { key: PanelTab; label: string }[] = [
  { key: "review", label: "Conversation" },
  { key: "commits", label: "Commits" },
  { key: "files", label: "Files changed" },
  { key: "result", label: "Result" },
];

type VoteValue = -10 | -5 | 0 | 5 | 10;

const VOTE_OPTIONS: { vote: VoteValue; label: string }[] = [
  { vote: 10, label: "Approve" },
  { vote: 5, label: "Suggestions" },
  { vote: -5, label: "Wait" },
  { vote: -10, label: "Reject" },
  { vote: 0, label: "No vote" },
];

export function PrReviewPanel({
  selectedPr,
  maximized = false,
  onToggleMaximize,
}: {
  selectedPr: ReviewPullRequestSummary | null;
  maximized?: boolean;
  onToggleMaximize?: () => void;
}) {
  const [tab, setTab] = useState<PanelTab>("review");

  const reviewQuery = useQuery({
    queryKey: [
      "prReview",
      selectedPr?.organizationId,
      selectedPr?.repositoryId,
      selectedPr?.pullRequestId,
    ],
    queryFn: () => getPullRequestReview(prLocator(selectedPr as ReviewPullRequestSummary)),
    enabled: !!selectedPr && (tab === "review" || tab === "files"),
    staleTime: 60_000,
  });

  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  // The Result tab only surfaces a local HTML folder, so hide it until one is
  // configured instead of showing an empty "not configured" tab.
  const hasReviewResultFolder = !!settingsQuery.data?.reviewResultFolderPath;
  const tabs = hasReviewResultFolder
    ? PANEL_TABS
    : PANEL_TABS.filter((option) => option.key !== "result");

  useEffect(() => {
    if (!hasReviewResultFolder && tab === "result") setTab("review");
  }, [hasReviewResultFolder, tab]);

  // Reviewer management lives in the header now, but the mutations belong to the
  // panel (which owns the review query) so the header can stay presentational.
  const queryClient = useQueryClient();
  const [reviewerError, setReviewerError] = useState<string | null>(null);
  function invalidateReviewerData() {
    if (!selectedPr) return;
    void queryClient.invalidateQueries({
      queryKey: ["prReview", selectedPr.organizationId, selectedPr.repositoryId, selectedPr.pullRequestId],
    });
    void queryClient.invalidateQueries({ queryKey: ["myReviews", selectedPr.organizationId] });
  }
  const reviewerRequiredMutation = useMutation({
    mutationFn: setPullRequestReviewerRequired,
    onSuccess: () => {
      setReviewerError(null);
      invalidateReviewerData();
    },
    onError: (error) => setReviewerError(commandErrorMessage(error)),
  });
  const removeReviewerMutation = useMutation({
    mutationFn: removePullRequestReviewer,
    onSuccess: () => {
      setReviewerError(null);
      invalidateReviewerData();
    },
    onError: (error) => setReviewerError(commandErrorMessage(error)),
  });
  const reviewerActionsBusy = reviewerRequiredMutation.isPending || removeReviewerMutation.isPending;

  // Esc / ← step back to the grid from anywhere in the preview that is not a
  // text field (composer Esc is handled locally and stops propagation first).
  function handlePreviewKeyDown(event: React.KeyboardEvent) {
    if (isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusPrimaryGrid();
    }
  }

  return (
    <aside
      onKeyDown={handlePreviewKeyDown}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card focus-within:ring-2 focus-within:ring-ring"
    >
      {/* Persistent PR header (visible on every tab), GitHub-style. Reviewers
          (with required/optional + remove controls) render here too. */}
      <PrReviewHeader
        selectedPr={selectedPr}
        review={reviewQuery.data ?? null}
        maximized={maximized}
        onToggleMaximize={onToggleMaximize}
        reviewerActionsBusy={reviewerActionsBusy}
        onToggleReviewerRequired={(reviewer) => {
          if (!selectedPr || !reviewer.id) return;
          reviewerRequiredMutation.mutate({
            ...prLocator(selectedPr),
            reviewerId: reviewer.id,
            isRequired: !reviewer.isRequired,
          });
        }}
        onRemoveReviewer={(reviewer) => {
          if (!selectedPr || !reviewer.id) return;
          if (window.confirm(`Remove ${reviewer.displayName} as a reviewer?`)) {
            removeReviewerMutation.mutate({ ...prLocator(selectedPr), reviewerId: reviewer.id });
          }
        }}
      />
      {reviewerError ? (
        <div className="shrink-0 border-b border-border bg-red-50 px-3 py-1 text-xs text-destructive dark:bg-red-950/40">
          {reviewerError}
        </div>
      ) : null}

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted p-0.5" role="tablist" aria-label="PR review tabs">
          {tabs.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={tab === option.key}
              onClick={() => setTab(option.key)}
              className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors ${
                tab === option.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {reviewQuery.isFetching && tab !== "result" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : null}
        </div>
      </div>

      {!selectedPr ? (
        <PreviewEmptyState message="Select a pull request." />
      ) : tab === "review" ? (
        <ReviewTab
          pr={selectedPr}
          review={reviewQuery.data ?? null}
          loading={reviewQuery.isLoading}
          error={reviewQuery.isError ? commandErrorMessage(reviewQuery.error) : null}
        />
      ) : tab === "files" ? (
        <Suspense fallback={<LoadingState />}>
          <PrFilesTab pr={selectedPr} threads={reviewQuery.data?.threads} />
        </Suspense>
      ) : tab === "commits" ? (
        <CommitsTab pr={selectedPr} />
      ) : (
        <ResultTab selectedPr={selectedPr} />
      )}
    </aside>
  );
}

// ── Review tab ───────────────────────────────────────────────────────────────

function ReviewTab({
  pr,
  review,
  loading,
  error,
}: {
  pr: ReviewPullRequestSummary;
  review: PullRequestReview | null;
  loading: boolean;
  error: string | null;
}) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const mentionSearch = usePrMentionSearch(pr.organizationId);

  // Reset draft state when another PR is selected.
  useEffect(() => {
    setActionError(null);
  }, [pr.pullRequestId, pr.repositoryId]);

  // Scope invalidation to this PR so other PRs' cached reviews stay warm.
  function invalidateReview() {
    void queryClient.invalidateQueries({
      queryKey: ["prReview", pr.organizationId, pr.repositoryId, pr.pullRequestId],
    });
    void queryClient.invalidateQueries({ queryKey: ["myReviews", pr.organizationId] });
  }

  const voteMutation = useMutation({
    mutationFn: submitPullRequestVote,
    onSuccess: () => {
      setActionError(null);
      invalidateReview();
    },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const commentMutation = useMutation({
    mutationFn: postPullRequestComment,
    onSuccess: () => {
      setActionError(null);
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

  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const readOnly = settingsQuery.data?.readOnlyValidationModeEnabled ?? false;

  // Linked work items: scan the PR description and commit messages for AB#NNN
  // mentions. Commits share the CommitsTab query key, so this stays warm.
  const commitsQuery = useQuery({
    queryKey: ["prCommits", pr.organizationId, pr.repositoryId, pr.pullRequestId],
    queryFn: () => listPullRequestCommits(prLocator(pr)),
    staleTime: 60_000,
  });
  const linkedWorkItemIds = extractWorkItemMentions([
    review?.description,
    ...(commitsQuery.data?.map((commit) => commit.comment) ?? []),
  ]);

  const [mergeStrategy, setMergeStrategy] = useState("squash");
  const [deleteSourceBranch, setDeleteSourceBranch] = useState(false);
  const [transitionWorkItems, setTransitionWorkItems] = useState(false);

  const updateMutation = useMutation({
    mutationFn: updatePullRequest,
    onSuccess: () => {
      setActionError(null);
      invalidateReview();
    },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  // Inline title/description editing (#388).
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

  function startEditingDetails() {
    setDraftTitle(review?.title ?? "");
    setDraftDescription(review?.description ?? "");
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

  // Keep a focus target (Ctrl+P) present even on loading/error states.
  if (loading) {
    return (
      <div data-primary-preview="true" tabIndex={-1} className="min-h-0 flex-1 outline-none">
        <LoadingState />
      </div>
    );
  }
  if (error) {
    return (
      <div data-primary-preview="true" tabIndex={-1} className="min-h-0 flex-1 outline-none">
        <ErrorState message={error} />
      </div>
    );
  }
  if (!review) {
    return (
      <div data-primary-preview="true" tabIndex={-1} className="min-h-0 flex-1 outline-none">
        <PreviewEmptyState message="No review data." />
      </div>
    );
  }

  const myVote = review.reviewers.find((reviewer) => reviewer.isMe)?.vote ?? pr.myVote;
  const userThreads = review.threads.filter((thread) =>
    thread.comments.some((comment) => !comment.isSystem),
  );
  const systemThreads = review.threads.filter((thread) =>
    thread.comments.every((comment) => comment.isSystem),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Vote + primary merge action in one row; secondary actions (publish,
          auto-complete, branch / work-item toggles, abandon) live in the ⋯ menu
          so the row stays compact, matching the reference layout. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-1.5 text-xs">
        <label htmlFor="pr-vote-select" className="font-medium text-muted-foreground">
          Your vote
        </label>
        <select
          id="pr-vote-select"
          value={myVote}
          disabled={voteMutation.isPending}
          onChange={(event) =>
            voteMutation.mutate({
              ...prLocator(pr),
              vote: Number(event.target.value) as VoteValue,
            })
          }
          aria-label="Your vote"
          className={`h-7 rounded-md border px-2 font-medium outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 ${VOTE_BADGE_CLASSES[voteTone(myVote)]}`}
        >
          {VOTE_OPTIONS.map((option) => (
            <option key={option.vote} value={option.vote}>
              {option.label}
            </option>
          ))}
        </select>
        {voteMutation.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          <select
            aria-label="Merge strategy"
            value={mergeStrategy}
            disabled={readOnly || updateMutation.isPending}
            onChange={(event) => setMergeStrategy(event.target.value)}
            className="h-6 rounded border border-input bg-background px-1 outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            <option value="squash">Squash</option>
            <option value="noFastForward">Merge</option>
            <option value="rebase">Rebase</option>
            <option value="rebaseMerge">Rebase + merge</option>
          </select>
          <button
            type="button"
            disabled={readOnly || updateMutation.isPending}
            title={readOnly ? "Read-only validation mode is enabled" : undefined}
            onClick={() =>
              runPrAction("complete", `Complete (merge) this pull request using ${mergeStrategy}?`)
            }
            className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900"
          >
            Complete
          </button>
          {updateMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : null}
          <PrOverflowMenu
            isDraft={review.isDraft}
            autoComplete={review.autoComplete}
            readOnly={readOnly}
            pending={updateMutation.isPending}
            mergeStrategy={mergeStrategy}
            deleteSourceBranch={deleteSourceBranch}
            transitionWorkItems={transitionWorkItems}
            onToggleDeleteSourceBranch={() => setDeleteSourceBranch((value) => !value)}
            onToggleTransitionWorkItems={() => setTransitionWorkItems((value) => !value)}
            onAction={runPrAction}
          />
        </div>
      </div>

      {actionError ? (
        <div className="m-2 shrink-0 rounded-md border border-destructive/30 bg-red-50 dark:bg-red-950/40 px-2 py-1 text-xs text-destructive">
          {actionError}
        </div>
      ) : null}

      <div
        className="min-h-0 flex-1 overflow-y-auto outline-none"
        data-primary-preview="true"
        aria-keyshortcuts="Control+P"
        tabIndex={-1}
      >
        {/* Description (title and author/branch are shown in the header above). */}
        <PrPreviewSection
          title="Description"
          collapseId="description"
          className="px-3"
          headerAction={
            !editingDetails ? (
              <button
                type="button"
                onClick={startEditingDetails}
                aria-label="Edit title and description"
                title="Edit title and description"
                className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null
          }
        >
          {editingDetails ? (
            <div className="grid gap-2 pb-2">
              <label className="grid gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Title
                </span>
                <input
                  autoFocus
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setEditingDetails(false);
                    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault();
                      saveDetails();
                    }
                  }}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  aria-label="Pull request title"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Description
                </span>
                <textarea
                  value={draftDescription}
                  onChange={(event) => setDraftDescription(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setEditingDetails(false);
                    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault();
                      saveDetails();
                    }
                  }}
                  rows={4}
                  className="resize-y rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
                  aria-label="Pull request description"
                />
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveDetails}
                  disabled={!draftTitle.trim() || detailsMutation.isPending}
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingDetails(false)}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-accent"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Cancel
                </button>
                <span className="text-[11px] text-muted-foreground">Ctrl+Enter to save · Esc to cancel</span>
              </div>
            </div>
          ) : (
            <div className="pb-2">
              {review.description ? (
                <MarkdownView text={review.description} className="text-xs text-foreground" />
              ) : (
                <p className="text-xs italic text-muted-foreground">No description.</p>
              )}
            </div>
          )}
        </PrPreviewSection>

        {/* Linked work items (AB#NNN found in the description or commits). */}
        {linkedWorkItemIds.length > 0 ? (
          <PrPreviewSection
            title={`Work Items (${linkedWorkItemIds.length})`}
            collapseId="workItems"
            className="px-3"
          >
            <div className="flex flex-wrap gap-1 pb-2">
              {linkedWorkItemIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() =>
                    navigateToWorkItem({ organizationId: pr.organizationId, workItemId: id })
                  }
                  className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[11px] text-primary hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
                  title={`Open work item ${id} in Work Items`}
                >
                  AB#{id}
                </button>
              ))}
            </div>
          </PrPreviewSection>
        ) : null}

        {/* Comment threads */}
        <PrPreviewSection
          title={`Comments (${userThreads.length})`}
          collapseId="comments"
          className="px-3"
        >
          <div className="flex flex-col gap-2 pb-2">
            {userThreads.length === 0 ? (
              <p className="text-xs text-muted-foreground">No comments yet.</p>
            ) : (
              userThreads.map((thread) => (
                <PrThreadCard
                  key={thread.id}
                  thread={thread}
                  busy={commentMutation.isPending || statusMutation.isPending}
                  mentionSearch={mentionSearch}
                  onReply={(content) =>
                    commentMutation.mutateAsync({
                      ...prLocator(pr),
                      threadId: thread.id,
                      content,
                    }).then(() => undefined)
                  }
                  onToggleStatus={() => {
                    statusMutation.mutate({
                      ...prLocator(pr),
                      threadId: thread.id,
                      status: thread.isResolved ? "active" : "closed",
                    });
                  }}
                  onEditComment={(commentId, content) =>
                    editMutation.mutateAsync({
                      ...prLocator(pr),
                      threadId: thread.id,
                      commentId,
                      content,
                    }).then(() => undefined)
                  }
                  onDeleteComment={(commentId) =>
                    deleteMutation.mutateAsync({
                      ...prLocator(pr),
                      threadId: thread.id,
                      commentId,
                    })
                  }
                />
              ))
            )}
          </div>
        </PrPreviewSection>

        {/* System events (auto-generated threads) */}
        {systemThreads.length > 0 ? (
          <PrPreviewSection
            title={`System Events (${systemThreads.length})`}
            collapseId="systemEvents"
            className="px-3"
          >
            <ul className="space-y-0.5 pb-2 pl-3 text-xs text-muted-foreground">
              {systemThreads.map((thread) => (
                <li key={thread.id}>
                  {thread.comments[0]?.content ?? ""}
                  {thread.comments[0]?.publishedDate
                    ? ` · ${formatRelativeDate(thread.comments[0].publishedDate)}`
                    : ""}
                </li>
              ))}
            </ul>
          </PrPreviewSection>
        ) : null}
      </div>

      {/* New comment */}
      <div className="shrink-0 border-t border-border p-2">
        <CommentComposer
          placeholder="Add a comment… (Ctrl+Enter to post)"
          busy={commentMutation.isPending}
          mentionSearch={mentionSearch}
          onSubmit={(content) =>
            commentMutation.mutateAsync({ ...prLocator(pr), content }).then(() => undefined)
          }
        />
      </div>
    </div>
  );
}

// ── Commits tab ──────────────────────────────────────────────────────────────

function CommitsTab({ pr }: { pr: ReviewPullRequestSummary }) {
  const commitsQuery = useQuery({
    queryKey: ["prCommits", pr.organizationId, pr.repositoryId, pr.pullRequestId],
    queryFn: () => listPullRequestCommits(prLocator(pr)),
    staleTime: 60_000,
  });

  if (commitsQuery.isLoading) return <LoadingState />;
  if (commitsQuery.isError) {
    return <ErrorState message={commandErrorMessage(commitsQuery.error)} onRetry={() => void commitsQuery.refetch()} />;
  }
  const commits = commitsQuery.data ?? [];
  if (commits.length === 0) return <PreviewEmptyState message="No commits." />;

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto outline-none"
      data-primary-preview="true"
      aria-keyshortcuts="Control+P"
      tabIndex={-1}
    >
      {commits.map((commit) => {
        const webUrl = commit.webUrl;
        return (
          <div
            key={commit.commitId}
            className="flex items-center gap-2 border-b border-border px-2 py-1.5 text-xs"
          >
            <button
              type="button"
              onClick={() => {
                if (webUrl) openExternalUrl(webUrl);
              }}
              disabled={!webUrl}
              className="shrink-0 rounded border border-border bg-muted px-1.5 py-px font-mono text-[11px] text-primary hover:bg-secondary disabled:text-muted-foreground"
              title={commit.commitId}
            >
              {commit.shortCommitId}
            </button>
            <span className="min-w-0 flex-1 truncate text-foreground" title={commit.comment}>
              {commit.comment}
            </span>
            <span className="shrink-0 text-muted-foreground">{commit.authorName ?? ""}</span>
            {commit.authorDate ? (
              <span
                className="shrink-0 text-muted-foreground"
                title={formatDate(commit.authorDate)}
              >
                {formatRelativeDate(commit.authorDate)}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ── Result tab (local HTML review-result preview, moved from MyReviewsGrid) ──

function ResultTab({ selectedPr }: { selectedPr: ReviewPullRequestSummary }) {
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });

  const previewQuery = useQuery({
    queryKey: ["reviewResultPreview", selectedPr.pullRequestId],
    queryFn: () => getReviewResultPreview({ pullRequestId: selectedPr.pullRequestId }),
  });

  const hasFolder = !!settingsQuery.data?.reviewResultFolderPath;
  const preview = previewQuery.data ?? null;
  const [openError, setOpenError] = useState<string | null>(null);

  const openInBrowser = useCallback(() => {
    if (!preview) return;
    setOpenError(null);
    openLocalPath(preview.filePath).catch((error) =>
      setOpenError(commandErrorMessage(error)),
    );
  }, [preview]);

  // `o` opens the HTML file in the default browser while the Result tab is
  // focused (skipped in text fields and with modifiers).
  function handleResultKeyDown(event: React.KeyboardEvent) {
    if (isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "o" && preview) {
      event.preventDefault();
      openInBrowser();
    }
  }

  if (settingsQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading
      </div>
    );
  }
  if (!hasFolder) {
    return <PreviewEmptyState message="Review result folder is not configured." />;
  }
  if (previewQuery.isError) {
    return (
      <div className="m-3 rounded-md border border-destructive/30 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-destructive">
        {commandErrorMessage(previewQuery.error)}
      </div>
    );
  }
  if (previewQuery.isLoading) {
    return <LoadingState />;
  }
  if (!preview) {
    return <PreviewEmptyState message={`No HTML file matched PR${selectedPr.pullRequestId}.`} />;
  }
  return (
    <div
      className="flex min-h-0 flex-1 flex-col outline-none"
      data-primary-preview="true"
      aria-keyshortcuts="Control+P"
      tabIndex={-1}
      onKeyDown={handleResultKeyDown}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium" title={preview.fileName}>
            {preview.fileName}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={preview.filePath}>
            {preview.filePath}
          </p>
        </div>
        <button
          type="button"
          onClick={openInBrowser}
          title="Open the review result in your browser (o)"
          className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs font-medium hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          Open in browser
          <span className="text-muted-foreground/70">o</span>
        </button>
      </div>
      {openError ? (
        <div className="m-3 rounded-md border border-destructive/30 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-destructive">
          {openError}
        </div>
      ) : null}
      {/* `allow-same-origin` (without `allow-scripts`, so the document still
          can't run JS) is required for the WebView2 desktop runtime to render
          a `srcDoc` document at all; with `sandbox=""` the frame stays blank in
          the desktop app. Mirrors the work item RichHtmlFrame. */}
      <iframe
        title={`Review result preview for PR${preview.pullRequestId}`}
        sandbox="allow-same-origin"
        srcDoc={preview.html}
        className="min-h-0 flex-1 bg-card outline-none"
      />
    </div>
  );
}
