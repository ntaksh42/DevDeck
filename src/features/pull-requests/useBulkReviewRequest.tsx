import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { commandErrorMessage, runAutoQueue, type ReviewPullRequestSummary } from '@/lib/azdoCommands';
import { pushToast } from '@/lib/toast';
import { BulkReviewDialog } from './BulkReviewDialog';

/**
 * Asks the agent to review the selected My Reviews rows (the row under the
 * cursor when nothing is multi-selected). It takes the same path as the
 * automatic review (`run_auto_queue`): one PR at a time, incremental, with the
 * run history. A PR with no new push since its last review is skipped there.
 */
export function useBulkReviewRequest(selectedPrs: ReviewPullRequestSummary[]) {
  const [asking, setAsking] = useState<ReviewPullRequestSummary[] | null>(null);
  const run = useMutation({
    mutationFn: ({ targets, focus }: { targets: Parameters<typeof runAutoQueue>[0]; focus: string }) =>
      runAutoQueue(targets, focus.trim() || undefined),
    onSuccess: (count) =>
      pushToast(`Review requested for ${count} PR${count === 1 ? '' : 's'}, one at a time. Results appear in the result folder.`),
    onError: (error) => pushToast(`Review request failed: ${commandErrorMessage(error)}`),
  });

  function request() {
    if (selectedPrs.length === 0 || run.isPending) return;
    setAsking(selectedPrs);
  }

  const dialog = asking ? (
    <BulkReviewDialog
      titles={asking.map((pr) => `!${pr.pullRequestId} ${pr.title}`)}
      onCancel={() => setAsking(null)}
      onConfirm={(focus) => {
        const targets = asking.map((pr) => ({
          organizationId: pr.organizationId,
          target: 'pull-request' as const,
          id: pr.pullRequestId,
        }));
        setAsking(null);
        run.mutate({ targets, focus });
      }}
    />
  ) : null;

  return { request, dialog };
}
