import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Maximize2, Minimize2 } from "lucide-react";
import {
  commandErrorMessage,
  getAppSettings,
  getPullRequestReview,
  getReviewResultPreview,
  listPullRequestCommits,
  postPullRequestComment,
  prLocator,
  setPullRequestThreadStatus,
  submitPullRequestVote,
  type PullRequestReview,
  type ReviewPullRequestSummary,
} from "@/lib/azdoCommands";
import { formatDate, formatRelativeDate } from "@/lib/utils";
import { MarkdownView } from "@/lib/markdown";
import { openExternalUrl } from "@/lib/openExternal";
import { ShortcutHint } from "@/components/ShortcutHint";
import { LoadingState, ErrorState, PreviewEmptyState } from "@/components/StateDisplay";
import { PrFilesTab } from "./PrFilesTab";
import { PrThreadCard } from "./PrThreadCard";
import { VOTE_BUTTON_ACTIVE_CLASSES, VOTE_DOT_CLASSES, voteTone } from "./voteVisual";

type PanelTab = "review" | "files" | "commits" | "result";

const PANEL_TABS: { key: PanelTab; label: string }[] = [
  { key: "review", label: "Review" },
  { key: "files", label: "Files" },
  { key: "commits", label: "Commits" },
  { key: "result", label: "Result" },
];

const VOTE_OPTIONS: { vote: -10 | -5 | 0 | 5 | 10; label: string }[] = [
  { vote: 10, label: "Approve" },
  { vote: 5, label: "Suggestions" },
  { vote: -5, label: "Wait" },
  { vote: -10, label: "Reject" },
  { vote: 0, label: "Reset" },
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

  return (
    <aside className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-white focus-within:ring-2 focus-within:ring-ring">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-gray-50 p-0.5" role="tablist" aria-label="PR review tabs">
          {PANEL_TABS.map((option) => (
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
          <span className="truncate text-xs text-muted-foreground">
            {selectedPr ? `PR #${selectedPr.pullRequestId}` : "No PR selected"}
          </span>
          {reviewQuery.isFetching && tab !== "result" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : (
            <ShortcutHint>Alt+P</ShortcutHint>
          )}
          {onToggleMaximize ? (
            <button
              type="button"
              onClick={onToggleMaximize}
              aria-label={maximized ? "Restore split view" : "Maximize review panel"}
              aria-pressed={maximized}
              title={`${maximized ? "Restore split view" : "Maximize review panel"} (F)`}
              className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {maximized ? (
                <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
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
  const [newComment, setNewComment] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  // Reset draft state when another PR is selected.
  useEffect(() => {
    setNewComment("");
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
    onSuccess: (_thread, variables) => {
      setActionError(null);
      if (variables.threadId == null) setNewComment("");
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
      {/* Vote buttons */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
        {VOTE_OPTIONS.map((option) => {
          const active = myVote === option.vote && option.vote !== 0;
          return (
            <button
              key={option.vote}
              type="button"
              disabled={voteMutation.isPending}
              onClick={() => voteMutation.mutate({ ...prLocator(pr), vote: option.vote })}
              className={`rounded border px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${
                active
                  ? VOTE_BUTTON_ACTIVE_CLASSES[voteTone(option.vote)]
                  : "border-border bg-white text-muted-foreground hover:bg-secondary"
              }`}
              title={`Vote: ${option.label}`}
            >
              {option.label}
            </button>
          );
        })}
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
        {/* Meta + description */}
        <div className="border-b border-border px-3 py-2">
          <p className="text-sm font-semibold">{review.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
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
      <form
        className="shrink-0 border-t border-border p-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!newComment.trim()) return;
          commentMutation.mutate({ ...prLocator(pr), content: newComment });
        }}
      >
        <textarea
          value={newComment}
          onChange={(event) => setNewComment(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              if (newComment.trim()) {
                commentMutation.mutate({ ...prLocator(pr), content: newComment });
              }
            }
          }}
          rows={2}
          placeholder="Add a comment… (Ctrl+Enter to post)"
          aria-label="New pull request comment"
          className="w-full resize-y rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="mt-1 flex items-center justify-end gap-2">
          {commentMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : null}
          <button
            type="submit"
            disabled={!newComment.trim() || commentMutation.isPending}
            className="rounded border border-border bg-white px-2 py-0.5 text-xs hover:bg-secondary disabled:opacity-50"
          >
            Comment
          </button>
        </div>
      </form>
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
