import {
  AlertTriangle,
  CheckCircle2,
  Loader,
  MessageSquare,
  X,
  XCircle,
} from "lucide-react";
import { formatRelativeDate } from "@/lib/utils";
import type {
  PrReviewer,
  PullRequestReview,
  ReviewPullRequestSummary,
} from "@/lib/azdoCommands";
import { VOTE_DOT_CLASSES, voteTone } from "./voteVisual";

const BADGE_BASE =
  "inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium";

function shortRef(refName: string): string {
  return refName.replace(/^refs\/heads\//, "");
}

function StateBadge({ isDraft }: { isDraft: boolean }) {
  if (isDraft) {
    return (
      <span
        className={`${BADGE_BASE} border-input bg-muted text-muted-foreground`}
      >
        Draft
      </span>
    );
  }
  return (
    <span
      className={`${BADGE_BASE} border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300`}
    >
      <span
        className="h-1.5 w-1.5 rounded-full bg-emerald-500"
        aria-hidden="true"
      />
      Active
    </span>
  );
}

// CI verdict badge. Mirrors MyReviewsGrid's CiBadge colors/icons, but with a
// text label since the header has room. An unknown/none verdict renders nothing
// so a missing CI fetch never reads as a state.
function ciBadge(pr: ReviewPullRequestSummary) {
  const status = pr.ciStatus ?? "none";
  if (status === "failed") {
    return (
      <span
        key="ci"
        className={`${BADGE_BASE} border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300`}
      >
        <XCircle className="h-3 w-3" aria-hidden="true" />
        CI failed · {pr.ciCheckCount}
      </span>
    );
  }
  if (status === "succeeded") {
    return (
      <span
        key="ci"
        className={`${BADGE_BASE} border-green-200 bg-green-100 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300`}
      >
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        CI passed
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span
        key="ci"
        className={`${BADGE_BASE} border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300`}
      >
        <Loader className="h-3 w-3 animate-spin" aria-hidden="true" />
        CI running
      </span>
    );
  }
  return null;
}

function conflictsBadge(pr: ReviewPullRequestSummary) {
  if (pr.mergeStatus !== "conflicts") return null;
  return (
    <span
      key="conflicts"
      className={`${BADGE_BASE} border-orange-200 bg-orange-100 text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-300`}
      title="This pull request has merge conflicts"
    >
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      Conflicts
    </span>
  );
}

function approvedBadge(review: PullRequestReview | null) {
  if (!review || review.reviewers.length === 0) return null;
  const total = review.reviewers.length;
  const approved = review.reviewers.filter(
    (reviewer) => reviewer.vote === 10,
  ).length;
  const complete = approved >= total;
  return (
    <span
      key="approved"
      className={`${BADGE_BASE} ${
        complete
          ? "border-green-200 bg-green-100 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
          : "border-border bg-muted text-muted-foreground"
      }`}
      title={`${approved} of ${total} reviewers approved`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${approved > 0 ? "bg-emerald-500" : "bg-gray-300"}`}
        aria-hidden="true"
      />
      {approved} / {total} approved
    </span>
  );
}

// Comment activity badge. Counts only threads that carry a human comment
// (mirrors the user-thread filter in usePrReviewPanels) so auto-generated system
// threads such as votes and ref updates do not inflate the number. Highlights
// when any thread is still unresolved; renders nothing when there are no
// comment threads so an empty PR does not show a "0".
function commentsBadge(review: PullRequestReview | null) {
  if (!review) return null;
  const commentThreads = review.threads.filter((thread) =>
    thread.comments.some((comment) => !comment.isSystem),
  );
  if (commentThreads.length === 0) return null;
  const unresolved = commentThreads.filter(
    (thread) => !thread.isResolved,
  ).length;
  const hasUnresolved = unresolved > 0;
  return (
    <span
      key="comments"
      className={`${BADGE_BASE} ${
        hasUnresolved
          ? "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
          : "border-border bg-muted text-muted-foreground"
      }`}
      title={`${commentThreads.length} comment thread${
        commentThreads.length === 1 ? "" : "s"
      }, ${unresolved} unresolved`}
    >
      <MessageSquare className="h-3 w-3" aria-hidden="true" />
      {hasUnresolved
        ? `${unresolved} unresolved`
        : `${commentThreads.length} resolved`}
    </span>
  );
}

// Persistent PR header shown above every tab. Pulls live fields from `review`
// when available (review/files tabs) and falls back to the cached summary
// `selectedPr` otherwise, so the title/branch/state stay populated on the
// commits and result tabs where the review query is not enabled.
export function PrReviewHeader({
  selectedPr,
  review,
  reviewerActionsBusy = false,
  onToggleReviewerRequired,
  onRemoveReviewer,
  compact = false,
}: {
  selectedPr: ReviewPullRequestSummary | null;
  review: PullRequestReview | null;
  reviewerActionsBusy?: boolean;
  onToggleReviewerRequired?: (reviewer: PrReviewer) => void;
  onRemoveReviewer?: (reviewer: PrReviewer) => void;
  /** One line (id + title) instead of the full metadata block. */
  compact?: boolean;
}) {
  if (!selectedPr) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="text-sm text-muted-foreground">No PR selected</span>
      </div>
    );
  }

  const title = review?.title ?? selectedPr.title;

  // Result-style tabs need the room for their own content; the full metadata
  // is one tab away in Conversation.
  if (compact) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1">
        <h2 className="min-w-0 flex-1 truncate text-xs text-foreground" title={title}>
          <span className="font-mono font-semibold">#{selectedPr.pullRequestId}</span>{" "}
          {title}
        </h2>
      </div>
    );
  }

  const isDraft = review?.isDraft ?? selectedPr.isDraft;
  const createdBy = review?.createdBy ?? selectedPr.createdBy;
  const creationDate = review?.creationDate ?? selectedPr.creationDate;
  const sourceRef = review?.sourceRefName ?? null;
  const targetRef = review?.targetRefName ?? selectedPr.targetRefName;
  const branchLabel = sourceRef
    ? `${shortRef(sourceRef)} → ${shortRef(targetRef)}`
    : `→ ${shortRef(targetRef)}`;
  const branchTitle = sourceRef ? branchLabel : `into ${shortRef(targetRef)}`;

  // Only state and problems (CI, conflicts, open threads) sit in the colored
  // badge row; approvals live with the reviewers they summarize.
  const statusBadges = [
    ciBadge(selectedPr),
    conflictsBadge(selectedPr),
    commentsBadge(review),
  ].filter(Boolean);
  const reviewers = review?.reviewers ?? [];

  // Read top-down: what the PR is (title, full width), what needs attention
  // (status badges), where it
  // came from (branch, then id / author), then who reviews.
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-border px-2 py-1.5">
      <h2
        className="line-clamp-2 min-w-0 text-sm font-semibold leading-snug text-foreground"
        title={title}
      >
        {title}
      </h2>
      <div
        role="group"
        aria-label="Pull request metadata"
        className="flex min-w-0 flex-col gap-1"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <StateBadge isDraft={isDraft} />
          {statusBadges}
        </div>
        <p className="min-w-0 truncate font-mono text-xs text-foreground" title={branchTitle}>
          {branchLabel}
        </p>
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          <span className="font-mono font-semibold text-foreground">
            #{selectedPr.pullRequestId}
          </span>
          {" · "}
          {createdBy ?? "Unknown"}
          {creationDate ? ` · opened ${formatRelativeDate(creationDate)}` : ""}
        </p>
        {reviewers.length > 0 ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <span className="mr-0.5 text-xs text-muted-foreground">Reviewers</span>
            {approvedBadge(review)}
            {reviewers.map((reviewer) => (
              <span
                key={reviewer.id ?? `${reviewer.displayName}-${reviewer.isMe}`}
                className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-foreground"
                title={`${reviewer.voteLabel}${reviewer.isRequired ? " (Required)" : ""}`}
              >
                {reviewer.displayName}
                {reviewer.isMe ? " (you)" : ""}
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${VOTE_DOT_CLASSES[voteTone(reviewer.vote)]}`}
                  aria-hidden="true"
                />
                {reviewer.id && onToggleReviewerRequired && onRemoveReviewer ? (
                  <>
                    <button
                      type="button"
                      disabled={reviewerActionsBusy}
                      onClick={() => onToggleReviewerRequired(reviewer)}
                      title={reviewer.isRequired ? "Make optional" : "Make required"}
                      aria-label={`${reviewer.isRequired ? "Make optional" : "Make required"}: ${reviewer.displayName}`}
                      className="rounded px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
                    >
                      {reviewer.isRequired ? "Req" : "Opt"}
                    </button>
                    <button
                      type="button"
                      disabled={reviewerActionsBusy}
                      onClick={() => onRemoveReviewer(reviewer)}
                      aria-label={`Remove reviewer ${reviewer.displayName}`}
                      title="Remove reviewer"
                      className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-destructive disabled:opacity-50"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
