import { useState, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { listMyWorkItems, commandErrorMessage } from '@/lib/azdoCommands';
import { useActiveOrganizationId } from '@/lib/useActiveConnection';
import { matchesWorkItemQuery, parseSearchQuery } from '@/lib/searchQuery';
import { handleSearchInputEscape } from '@/lib/utils';
import { ErrorState } from '@/components/StateDisplay';
import { WorkItemsGrid } from './WorkItemsGrid';
import { WorkItemTemplatesPanel } from './WorkItemTemplatesPanel';
import { CreateWorkItemDialog, type CreateWorkItemDraft } from './CreateWorkItemDialog';
import { toMatchTarget } from './workItemMatchTarget';
import { workItemQueryKeys } from './queryKeys';

export function MyWorkItemsPanel() {
  const selectedOrganizationId = useActiveOrganizationId();
  const [filter, setFilter] = useState("");
  const [createDraft, setCreateDraft] = useState<CreateWorkItemDraft | null>(null);
  const [createdStatus, setCreatedStatus] = useState<string | null>(null);
  const statusTimeoutRef = useRef<number | null>(null);

  const query = useQuery({
    queryKey: workItemQueryKeys.myItems(selectedOrganizationId),
    queryFn: () => listMyWorkItems({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
    staleTime: 5 * 60_000,
  });

  const allResults = query.data ?? [];
  const results = useMemo(() => {
    const parsed = parseSearchQuery(filter);
    if (parsed.filters.length === 0 && parsed.text.length === 0) return allResults;
    return allResults.filter((item) => matchesWorkItemQuery(toMatchTarget(item), parsed));
  }, [allResults, filter]);

  function showCreatedStatus(message: string) {
    setCreatedStatus(message);
    if (statusTimeoutRef.current !== null) window.clearTimeout(statusTimeoutRef.current);
    statusTimeoutRef.current = window.setTimeout(() => setCreatedStatus(null), 5000);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="flex h-8 min-w-[180px] flex-1 items-center rounded-md border border-input bg-background px-2 focus-within:ring-2 focus-within:ring-ring">
          <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => handleSearchInputEscape(event, () => setFilter(""))}
            placeholder="Filter… try #1234, p:1, @user, s:active, t:bug"
            aria-label="Filter"
            title="Smart search: #1234 jumps to an id, p:1–4 priority, @user assignee, s:active state, t:bug type. Unknown prefixes are searched as text."
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>

        <button
          type="button"
          onClick={() => setCreateDraft({})}
          title="Create a new work item"
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          New item
        </button>
        <WorkItemTemplatesPanel
          onApplyTemplate={(fields) =>
            setCreateDraft({
              workItemType: fields.workItemType,
              title: fields.title,
              priority: fields.priority != null ? String(fields.priority) : undefined,
              areaPath: fields.areaPath,
              iterationPath: fields.iteration,
              tags: fields.tags.join("; "),
            })
          }
        />
        {createdStatus ? (
          <span role="status" className="truncate text-[11px] text-muted-foreground">
            {createdStatus}
          </span>
        ) : null}
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
        triageScope={`myWorkItems:${selectedOrganizationId}`}
        snoozeOrganizationId={selectedOrganizationId}
      />

      {createDraft ? (
        <CreateWorkItemDialog
          initialDraft={createDraft}
          onClose={() => setCreateDraft(null)}
          onCreated={(item) => showCreatedStatus(`Created #${item.id} "${item.title}".`)}
        />
      ) : null}
    </div>
  );
}
