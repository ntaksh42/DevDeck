import {
  AlertTriangle,
  CheckCircle2,
  Loader,
  Maximize2,
  Minimize2,
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
      <span className={`${BADGE_BASE} border-input bg-muted text-muted-foreground`}>
        Draft
      </span>
    );
  }
  return (
    <span
      className={`${BADGE_BASE} border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
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
  const approved = review.reviewers.filter((reviewer) => reviewer.vote === 10).length;
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

// Persistent PR header shown above every tab. Pulls live fields from `review`
// when available (review/files tabs) and falls back to the cached summary
// `selectedPr` otherwise, so the title/branch/state stay populated on the
// commits and result tabs where the review query is not enabled.
export function PrReviewHeader({
  selectedPr,
  review,
  maximized,
  onToggleMaximize,
  reviewerActionsBusy = false,
  onToggleReviewerRequired,
  onRemoveReviewer,
}: {
  selectedPr: ReviewPullRequestSummary | null;
  review: PullRequestReview | null;
  maximized: boolean;
  onToggleMaximize?: () => void;
  reviewerActionsBusy?: boolean;
  onToggleReviewerRequired?: (reviewer: PrReviewer) => void;
  onRemoveReviewer?: (reviewer: PrReviewer) => void;
}) {
  const maximizeButton = onToggleMaximize ? (
    <button
      type="button"
      onClick={onToggleMaximize}
      aria-label={maximized ? "Restore split view" : "Maximize review panel"}
      aria-pressed={maximized}
      title={`${maximized ? "Restore split view" : "Maximize review panel"} (\\)`}
      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {maximized ? (
        <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </button>
  ) : null;

  if (!selectedPr) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="text-sm text-muted-foreground">No PR selected</span>
        <div className="ml-auto">{maximizeButton}</div>
      </div>
    );
  }

  const isDraft = review?.isDraft ?? selectedPr.isDraft;
  const title = review?.title ?? selectedPr.title;
  const createdBy = review?.createdBy ?? selectedPr.createdBy;
  const creationDate = review?.creationDate ?? selectedPr.creationDate;
  const sourceRef = review?.sourceRefName ?? null;
  const targetRef = review?.targetRefName ?? selectedPr.targetRefName;
  const branchLabel = sourceRef ? shortRef(sourceRef) : `→ ${shortRef(targetRef)}`;
  const branchTitle = sourceRef
    ? `${shortRef(sourceRef)} → ${shortRef(targetRef)}`
    : `into ${shortRef(targetRef)}`;

  const badges = [ciBadge(selectedPr), conflictsBadge(selectedPr), approvedBadge(review)].filter(
    Boolean,
  );

  return (
    <div className="flex shrink-0 flex-col gap-1 border-b border-border px-3 py-1.5">
      <div className="flex items-center gap-2">
        <StateBadge isDraft={isDraft} />
        <span className="shrink-0 font-mono text-xs font-semibold text-muted-foreground">
          #{selectedPr.pullRequestId}
        </span>
        <span
          className="ml-auto min-w-0 truncate font-mono text-[11px] text-muted-foreground"
          title={branchTitle}
        >
          {branchLabel}
        </span>
        {maximizeButton}
      </div>
      {/* The grid already shows the title in split view, so only repeat it in the
          header when maximized (grid hidden) to avoid a duplicate on screen. */}
      {maximized ? (
        <span className="truncate text-sm font-semibold text-foreground" title={title}>
          {title}
        </span>
      ) : null}
      <p className="truncate text-xs text-muted-foreground">
        {createdBy ?? "Unknown"}
        {creationDate ? ` · opened ${formatRelativeDate(creationDate)}` : ""}
      </p>
      {badges.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">{badges}</div>
      ) : null}
      {review && review.reviewers.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          {review.reviewers.map((reviewer) => (
            <span
              key={reviewer.id ?? `${reviewer.displayName}-${reviewer.isMe}`}
              className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
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
                    className="rounded px-1 text-[10px] font-medium uppercase tracking-wide hover:bg-background disabled:opacity-50"
                  >
                    {reviewer.isRequired ? "Req" : "Opt"}
                  </button>
                  <button
                    type="button"
                    disabled={reviewerActionsBusy}
                    onClick={() => onRemoveReviewer(reviewer)}
                    aria-label={`Remove reviewer ${reviewer.displayName}`}
                    title="Remove reviewer"
                    className="rounded p-0.5 hover:bg-background hover:text-destructive disabled:opacity-50"
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
  );
}
