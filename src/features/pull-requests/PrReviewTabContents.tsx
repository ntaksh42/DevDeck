import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Pencil, X } from "lucide-react";
import {
  commandErrorMessage,
  getAppSettings,
  listPullRequestCommits,
  prLocator,
  searchPullRequestMentions,
  type MentionCandidate,
  type PullRequestReview,
  type ReviewPullRequestSummary,
} from "@/lib/azdoCommands";
import { formatDate, formatRelativeDate } from "@/lib/utils";
import { extractWorkItemMentions, navigateToWorkItem } from "@/lib/crossLinks";
import { MarkdownView } from "@/lib/markdown";
import { openExternalUrl } from "@/lib/openExternal";
import { LoadingState, ErrorState, PreviewEmptyState } from "@/components/StateDisplay";
import { CommentComposer } from "./CommentComposer";
import { PrThreadCard } from "./PrThreadCard";
import { PrPreviewSection } from "./PrPreviewSection";
import { PrOverflowMenu } from "./PrOverflowMenu";
import { VOTE_BADGE_CLASSES, voteTone } from "./voteVisual";
import { usePrReviewActions } from "./usePrReviewActions";

function usePrMentionSearch(organizationId: string) {
  return useCallback(
    (query: string): Promise<MentionCandidate[]> =>
      searchPullRequestMentions({ organizationId, query }),
    [organizationId],
  );
}

type VoteValue = -10 | -5 | 0 | 5 | 10;

const VOTE_OPTIONS: { vote: VoteValue; label: string }[] = [
  { vote: 10, label: "Approve" },
  { vote: 5, label: "Suggestions" },
  { vote: -5, label: "Wait" },
  { vote: -10, label: "Reject" },
  { vote: 0, label: "No vote" },
];

// ── Review tab ───────────────────────────────────────────────────────────────

export function ReviewTab({
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
  const {
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
  } = usePrReviewActions(pr);

  const mentionSearch = usePrMentionSearch(pr.organizationId);

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
                onClick={() => startEditingDetails(review.title ?? "", review.description ?? "")}
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

export function CommitsTab({ pr }: { pr: ReviewPullRequestSummary }) {
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
