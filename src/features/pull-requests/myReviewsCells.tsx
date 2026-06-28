import { type ReactNode } from 'react';
import {
  CheckCircle2,
  CircleDashed,
  Loader,
  XCircle,
} from 'lucide-react';
import type { ReviewPullRequestSummary } from '@/lib/azdoCommands';
import { formatDate, formatRelativeDate } from '@/lib/utils';
import { openExternalUrl } from '@/lib/openExternal';
import { VOTE_BADGE_CLASSES, voteTone } from './voteVisual';
import { reviewAgeDays } from './myReviewsHelpers';
import type { SortKey, VoteValue } from './myReviewsTypes';

export function VoteBadge({ vote, label }: { vote: VoteValue; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${VOTE_BADGE_CLASSES[voteTone(vote)]}`}
    >
      {label}
    </span>
  );
}

export function RequiredBadge({ required }: { required: boolean }) {
  return required ? (
    <span className="inline-flex items-center rounded border border-blue-200 bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
      Required
    </span>
  ) : (
    <span className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
      Optional
    </span>
  );
}

export function CiBadge({ pr }: { pr: ReviewPullRequestSummary }) {
  const status = pr.ciStatus ?? 'none';
  const contextLabel = pr.ciContext ? pr.ciContext : '—';
  const statusLabel =
    status === 'succeeded'
      ? 'Succeeded'
      : status === 'failed'
        ? 'Failed'
        : status === 'in_progress'
          ? 'In progress'
          : 'Not run';
  const tooltip = `Pipeline: ${contextLabel} | Status: ${statusLabel} | ${pr.ciCheckCount} check${pr.ciCheckCount === 1 ? '' : 's'}`;

  let icon: ReactNode;
  if (status === 'succeeded') {
    icon = (
      <CheckCircle2
        className="h-3.5 w-3.5 text-green-600 dark:text-green-400"
        aria-hidden="true"
      />
    );
  } else if (status === 'failed') {
    icon = (
      <XCircle
        className="h-3.5 w-3.5 text-red-600 dark:text-red-400"
        aria-hidden="true"
      />
    );
  } else if (status === 'in_progress') {
    icon = (
      <Loader
        className="h-3.5 w-3.5 animate-spin text-amber-500 dark:text-amber-400"
        aria-hidden="true"
      />
    );
  } else {
    icon = (
      <CircleDashed
        className="h-3.5 w-3.5 text-muted-foreground/50"
        aria-hidden="true"
      />
    );
  }

  return (
    <span
      className="flex items-center justify-center"
      title={tooltip}
      aria-label={`CI ${statusLabel}`}
      role="img"
    >
      {icon}
    </span>
  );
}

export function renderPrCell(
  key: SortKey,
  pr: ReviewPullRequestSummary,
  isStale: boolean,
  returned: boolean,
): ReactNode {
  switch (key) {
    case 'pullRequestId':
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (pr.webUrl) openExternalUrl(pr.webUrl);
          }}
          className="truncate text-left font-mono text-xs text-primary hover:underline"
          title={`PR #${pr.pullRequestId}`}
        >
          #{pr.pullRequestId}
        </button>
      );
    case 'repositoryName':
      return (
        <span className="truncate text-sm text-foreground" title={pr.repositoryName}>
          {pr.repositoryName}
        </span>
      );
    case 'title':
      return (
        <div className="flex min-w-0 items-center gap-1.5">
          {returned ? (
            <span
              className="inline-flex shrink-0 items-center rounded border border-purple-300 bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-800 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300"
              title="The author pushed new changes after your review — returned to you"
            >
              Returned
            </span>
          ) : null}
          {pr.isDraft && (
            <span className="inline-flex shrink-0 items-center rounded border border-input bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              Draft
            </span>
          )}
          <span className="truncate font-medium text-foreground" title={pr.title}>
            {pr.title}
          </span>
          {pr.mergeStatus === 'conflicts' ? (
            <span
              className="inline-flex shrink-0 items-center rounded border border-red-200 bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
              title="This pull request has merge conflicts"
            >
              Conflicts
            </span>
          ) : null}
        </div>
      );
    case 'createdBy':
      return (
        <span
          className="truncate text-sm text-muted-foreground"
          title={pr.createdBy ?? 'Unknown'}
        >
          {pr.createdBy ?? 'Unknown'}
        </span>
      );
    case 'creationDate':
      return (
        <span
          className={`text-xs ${isStale ? 'font-medium text-orange-600 dark:text-orange-400' : 'text-muted-foreground'}`}
          title={formatDate(pr.creationDate)}
        >
          {formatRelativeDate(pr.creationDate)}
        </span>
      );
    case 'reviewAge': {
      const days = reviewAgeDays(pr.creationDate);
      return (
        <span
          className={`text-xs tabular-nums ${isStale ? 'font-medium text-orange-600 dark:text-orange-400' : 'text-muted-foreground'}`}
          title={
            days === null
              ? 'Review age unavailable'
              : `Open for ${days} day${days === 1 ? '' : 's'} (since ${formatDate(pr.creationDate)})`
          }
        >
          {days === null ? '—' : `${days}d`}
        </span>
      );
    }
    case 'targetRefName':
      return (
        <span
          className="truncate text-xs text-muted-foreground"
          title={pr.targetRefName}
        >
          {pr.targetRefName}
        </span>
      );
    case 'myIsRequired':
      return <RequiredBadge required={pr.myIsRequired} />;
    case 'myVote':
      return <VoteBadge vote={pr.myVote} label={pr.myVoteLabel} />;
    case 'ciStatus':
      return <CiBadge pr={pr} />;
  }
}
