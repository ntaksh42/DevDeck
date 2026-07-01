import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Star } from 'lucide-react';
import { listMyWorkItems, listFollowedWorkItems, commandErrorMessage } from '@/lib/azdoCommands';
import { useActiveOrganizationId } from '@/lib/useActiveConnection';
import { matchesWorkItemQuery, parseSearchQuery } from '@/lib/searchQuery';
import { ErrorState } from '@/components/StateDisplay';
import { WorkItemsGrid } from './WorkItemsGrid';
import { WorkItemTemplatesPanel } from './WorkItemTemplatesPanel';
import { toMatchTarget } from './workItemMatchTarget';
import { workItemQueryKeys } from './queryKeys';

type WorkItemScope = 'assigned' | 'followed';

export function MyWorkItemsPanel() {
  const selectedOrganizationId = useActiveOrganizationId();
  const [filter, setFilter] = useState("");
  const [scope, setScope] = useState<WorkItemScope>('assigned');

  const assignedQuery = useQuery({
    queryKey: workItemQueryKeys.myItems(selectedOrganizationId),
    queryFn: () => listMyWorkItems({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
    staleTime: 5 * 60_000,
  });
  // Local follow watchlist (issue #304); a separate query since it has no
  // bearing on what is assigned to the user.
  const followedQuery = useQuery({
    queryKey: workItemQueryKeys.follows(selectedOrganizationId),
    queryFn: () => listFollowedWorkItems({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
    staleTime: 60_000,
  });
  const query = scope === 'assigned' ? assignedQuery : followedQuery;

  const allResults = query.data ?? [];
  const results = useMemo(() => {
    const parsed = parseSearchQuery(filter);
    if (parsed.filters.length === 0 && parsed.text.length === 0) return allResults;
    return allResults.filter((item) => matchesWorkItemQuery(toMatchTarget(item), parsed));
  }, [allResults, filter]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div role="group" aria-label="Work item scope" className="inline-flex h-8 items-center rounded-md border border-border p-0.5">
          <button
            type="button"
            aria-pressed={scope === 'assigned'}
            onClick={() => setScope('assigned')}
            title="Work items assigned to you"
            className={`inline-flex h-7 items-center rounded px-2 text-xs font-medium ${scope === 'assigned' ? 'bg-secondary text-foreground' : 'hover:bg-secondary/60'}`}
          >
            Assigned to me
          </button>
          <button
            type="button"
            aria-pressed={scope === 'followed'}
            onClick={() => setScope('followed')}
            title="Work items you are following"
            className={`inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium ${scope === 'followed' ? 'bg-secondary text-foreground' : 'hover:bg-secondary/60'}`}
          >
            <Star className="h-3 w-3" aria-hidden="true" />
            Followed
          </button>
        </div>
        <div className="flex h-8 min-w-[180px] flex-1 items-center rounded-md border border-input bg-background px-2 focus-within:ring-2 focus-within:ring-ring">
          <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter… try #1234, p:1, @user, s:active, t:bug"
            aria-label="Filter"
            title="Smart search: #1234 jumps to an id, p:1–4 priority, @user assignee, s:active state, t:bug type. Unknown prefixes are searched as text."
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>

        <WorkItemTemplatesPanel />
      </div>
      {query.isError ? (
        <ErrorState message={commandErrorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : null}

      <WorkItemsGrid
        activeExternalFilterCount={filter.trim() ? 1 : 0}
        dataUpdatedAt={query.dataUpdatedAt}
        isFetching={query.isFetching && query.data !== undefined}
        loading={query.isFetching && query.data === undefined}
        onClearExternalFilters={() => setFilter("")}
        results={results}
        searched={query.isSuccess || query.isFetching}
        autoFocus
        emptyMessage={
          scope === 'followed'
            ? 'No followed work items. Follow one from its preview panel.'
            : undefined
        }
        triageScope={`${scope === 'assigned' ? 'myWorkItems' : 'followedWorkItems'}:${selectedOrganizationId}`}
        snoozeOrganizationId={selectedOrganizationId}
      />
    </div>
  );
}
