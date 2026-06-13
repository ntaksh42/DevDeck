import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Maximize2, Minimize2 } from "lucide-react";
import {
  commandErrorMessage,
  deletePullRequestComment,
  editPullRequestComment,
  getAppSettings,
  getPullRequestReview,
  getReviewResultPreview,
  listPullRequestCommits,
  postPullRequestComment,
  prLocator,
  searchPullRequestMentions,
  setPullRequestThreadStatus,
  submitPullRequestVote,
  type MentionCandidate,
  type PullRequestReview,
  type ReviewPullRequestSummary,
} from "@/lib/azdoCommands";
import { focusPrimaryGrid, formatDate, formatRelativeDate, isEditableTarget } from "@/lib/utils";
import { MarkdownView } from "@/lib/markdown";
import { openExternalUrl } from "@/lib/openExternal";
import { LoadingState, ErrorState, PreviewEmptyState } from "@/components/StateDisplay";
import { CommentComposer } from "./CommentComposer";
import { PrFilesTab } from "./PrFilesTab";
import { PrThreadCard } from "./PrThreadCard";
import { VOTE_BADGE_CLASSES, VOTE_DOT_CLASSES, voteTone } from "./voteVisual";

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
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-white focus-within:ring-2 focus-within:ring-ring"
    >
      {/* Persistent PR header (visible on every tab), GitHub-style. */}
      <div className="flex shrink-0 items-baseline gap-2 border-b border-border px-3 py-1.5">
        {selectedPr ? (
          <>
            {/* The grid already shows titles in split view, so only repeat the
                title in the header when maximized (grid hidden). */}
            {maximized ? (
              <span className="truncate text-sm font-semibold" title={selectedPr.title}>
                {selectedPr.title}
              </span>
            ) : null}
            <span className="shrink-0 font-mono text-xs font-semibold text-muted-foreground">
              #{selectedPr.pullRequestId}
            </span>
            <span
              className="ml-auto shrink-0 truncate font-mono text-[11px] text-muted-foreground"
              title={`into ${selectedPr.targetRefName}`}
            >
              → {selectedPr.targetRefName}
            </span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">No PR selected</span>
        )}
        {onToggleMaximize ? (
          <button
            type="button"
            onClick={onToggleMaximize}
            aria-label={maximized ? "Restore split view" : "Maximize review panel"}
            aria-pressed={maximized}
            title={`${maximized ? "Restore split view" : "Maximize review panel"} (\\)`}
            className={`shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring ${
              selectedPr ? "" : "ml-auto"
            }`}
          >
            {maximized ? (
              <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-gray-50 p-0.5" role="tablist" aria-label="PR review tabs">
          {tabs.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={tab === option.key}
              onClick={() => setTab(option.key)}
              className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors ${
                tab === option.key
                  ? "bg-white text-foreground shadow-sm"
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
        <PrFilesTab pr={selectedPr} threads={reviewQuery.data?.threads} />
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
    void queryClient.invalidateQueries({ queryKey: ["myReviews"] });
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

  // Keep a focus target (Alt+P) present even on loading/error states.
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
      {/* Vote control: a single dropdown that shows and sets the current vote. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <label htmlFor="pr-vote-select" className="text-xs font-medium text-muted-foreground">
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
          className={`h-7 rounded-md border px-2 text-xs font-medium outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 ${VOTE_BADGE_CLASSES[voteTone(myVote)]}`}
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
      </div>

      {actionError ? (
        <div className="m-2 shrink-0 rounded-md border border-destructive/30 bg-red-50 px-2 py-1 text-xs text-destructive">
          {actionError}
        </div>
      ) : null}

      <div
        className="min-h-0 flex-1 overflow-y-auto outline-none"
        data-primary-preview="true"
        aria-keyshortcuts="Alt+P"
        tabIndex={-1}
      >
        {/* Meta + description (title shown in the persistent header above) */}
        <div className="border-b border-border px-3 py-2">
          <p className="text-xs text-muted-foreground">
            {review.createdBy ?? "Unknown"}
            {review.creationDate ? ` · ${formatRelativeDate(review.creationDate)}` : ""}
            {" · "}
            {review.sourceRefName} → {review.targetRefName}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {review.reviewers.map((reviewer) => (
              <span
                key={`${reviewer.displayName}-${reviewer.isMe}`}
                className="inline-flex items-center gap-1 rounded border border-border bg-gray-50 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                title={`${reviewer.voteLabel}${reviewer.isRequired ? " (Required)" : ""}`}
              >
                {reviewer.displayName}
                {reviewer.isMe ? " (you)" : ""}
                <VoteDot vote={reviewer.vote} />
              </span>
            ))}
          </div>
          {review.description ? (
            <MarkdownView text={review.description} className="mt-2 text-xs text-foreground" />
          ) : (
            <p className="mt-2 text-xs italic text-muted-foreground">No description.</p>
          )}
        </div>

        {/* Threads */}
        <div className="flex flex-col gap-2 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Comments ({userThreads.length})
          </p>
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
          {systemThreads.length > 0 ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">
                System events ({systemThreads.length})
              </summary>
              <ul className="mt-1 space-y-0.5 pl-3">
                {systemThreads.map((thread) => (
                  <li key={thread.id}>
                    {thread.comments[0]?.content ?? ""}
                    {thread.comments[0]?.publishedDate
                      ? ` · ${formatRelativeDate(thread.comments[0].publishedDate)}`
                      : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
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

function VoteDot({ vote }: { vote: number }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${VOTE_DOT_CLASSES[voteTone(vote)]}`}
      aria-hidden="true"
    />
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
    return <ErrorState message={commandErrorMessage(commitsQuery.error)} />;
  }
  const commits = commitsQuery.data ?? [];
  if (commits.length === 0) return <PreviewEmptyState message="No commits." />;

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto outline-none"
      data-primary-preview="true"
      aria-keyshortcuts="Alt+P"
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
              className="shrink-0 rounded border border-border bg-gray-50 px-1.5 py-px font-mono text-[11px] text-primary hover:bg-secondary disabled:text-muted-foreground"
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
      <div className="m-3 rounded-md border border-destructive/30 bg-red-50 p-3 text-sm text-destructive">
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
    <>
      <div className="border-b border-border px-3 py-2">
        <p className="truncate text-xs font-medium" title={preview.fileName}>
          {preview.fileName}
        </p>
        <p className="truncate text-xs text-muted-foreground" title={preview.filePath}>
          {preview.filePath}
        </p>
      </div>
      <iframe
        title={`Review result preview for PR${preview.pullRequestId}`}
        aria-keyshortcuts="Alt+P"
        sandbox=""
        srcDoc={preview.html}
        className="min-h-0 flex-1 bg-white outline-none"
        data-primary-preview="true"
        tabIndex={-1}
      />
    </>
  );
}
