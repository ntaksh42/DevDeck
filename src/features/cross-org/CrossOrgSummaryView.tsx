import { useRef } from 'react';
import { useQueries } from '@tanstack/react-query';
import { GitPullRequest, Layers, ListChecks } from 'lucide-react';
import {
  listMyReviewPullRequests,
  listMyWorkItems,
  listOrganizations,
  setActiveOrganization,
  type Organization,
} from '@/lib/azdoCommands';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LoadingState } from '@/components/StateDisplay';
import { summarizeOrganization, totalsFor } from './crossOrgSummary';

function orgLabel(org: Organization): string {
  return org.displayName?.trim() || org.name;
}

/**
 * Cross-organization "what needs me today" summary. Per the spec this adds no
 * new IPC: it fans the existing per-organization queries out with `useQueries`
 * and totals the synced results.
 */
export function CrossOrgSummaryView({
  onOpenView,
}: {
  onOpenView: (view: 'myReviews' | 'myWorkItems') => void;
}) {
  const queryClient = useQueryClient();
  const cardsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const organizationsQuery = useQuery({
    queryKey: ['organizations'],
    queryFn: listOrganizations,
    staleTime: 5 * 60_000,
  });
  const organizations = organizationsQuery.data ?? [];

  const reviewQueries = useQueries({
    queries: organizations.map((org) => ({
      queryKey: ['myReviews', org.id],
      queryFn: () => listMyReviewPullRequests({ organizationId: org.id }),
      staleTime: 5 * 60_000,
    })),
  });
  const workItemQueries = useQueries({
    queries: organizations.map((org) => ({
      queryKey: ['myWorkItems', org.id],
      queryFn: () => listMyWorkItems({ organizationId: org.id }),
      staleTime: 5 * 60_000,
    })),
  });

  const summaries = organizations.map((org, index) =>
    summarizeOrganization(
      org.id,
      orgLabel(org),
      reviewQueries[index]?.data,
      workItemQueries[index]?.data,
    ),
  );
  const totals = totalsFor(summaries);
  const loading =
    organizationsQuery.isLoading ||
    reviewQueries.some((q) => q.isLoading) ||
    workItemQueries.some((q) => q.isLoading);

  // Opening a row switches the active connection first, so the destination view
  // shows that organization's data rather than whatever was active before.
  function openFor(organizationId: string, view: 'myReviews' | 'myWorkItems') {
    const alreadyActive = organizations.length === 1;
    if (alreadyActive) {
      onOpenView(view);
      return;
    }
    setActiveOrganization(organizationId)
      .then(() => queryClient.invalidateQueries())
      .catch(() => undefined)
      .finally(() => onOpenView(view));
  }

  // Arrow keys move between cards; Enter/Space activate via native button
  // behavior. Keyboard access is a hard requirement, not a nicety.
  function onCardKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const cards = cardsRef.current.filter(Boolean);
    const next = Math.max(0, Math.min(index + delta, cards.length - 1));
    cards[next]?.focus();
  }

  if (loading && organizations.length === 0) {
    return <LoadingState />;
  }

  if (organizations.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Add a connection to see a cross-organization summary.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
      <div>
        <h1 className="text-lg font-semibold">Cross-organization summary</h1>
        <p className="text-sm text-muted-foreground">
          Totals across {organizations.length}{' '}
          {organizations.length === 1 ? 'connection' : 'connections'}, from data
          already synced.
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-card p-3">
          <dt className="flex items-center gap-2 text-sm text-muted-foreground">
            <GitPullRequest className="h-4 w-4" aria-hidden="true" />
            Needs my review
          </dt>
          <dd className="text-2xl font-semibold tabular-nums">
            {totals.needsMyReview}
          </dd>
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <dt className="flex items-center gap-2 text-sm text-muted-foreground">
            <ListChecks className="h-4 w-4" aria-hidden="true" />
            My work items
          </dt>
          <dd className="text-2xl font-semibold tabular-nums">
            {totals.myWorkItems}
          </dd>
        </div>
      </dl>

      <div className="grid gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Layers className="h-4 w-4" aria-hidden="true" />
          By connection
        </h2>
        {summaries.map((summary, index) => (
          <div
            key={summary.organizationId}
            className="grid gap-2 rounded-md border border-border bg-card p-3 sm:grid-cols-[1fr_auto_auto]"
          >
            <span className="self-center text-sm font-medium">
              {summary.organizationLabel}
            </span>
            <button
              type="button"
              ref={(el) => {
                cardsRef.current[index * 2] = el;
              }}
              onKeyDown={(event) => onCardKeyDown(event, index * 2)}
              onClick={() => openFor(summary.organizationId, 'myReviews')}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <GitPullRequest className="h-4 w-4" aria-hidden="true" />
              {summary.needsMyReview} to review
            </button>
            <button
              type="button"
              ref={(el) => {
                cardsRef.current[index * 2 + 1] = el;
              }}
              onKeyDown={(event) => onCardKeyDown(event, index * 2 + 1)}
              onClick={() => openFor(summary.organizationId, 'myWorkItems')}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <ListChecks className="h-4 w-4" aria-hidden="true" />
              {summary.myWorkItems} work items
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
