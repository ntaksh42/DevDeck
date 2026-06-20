import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { listMyWorkItems, commandErrorMessage, type Organization, type WorkItemSummary } from '@/lib/azdoCommands';
import {
  matchesWorkItemQuery,
  parseSearchQuery,
  type WorkItemMatchTarget,
} from '@/lib/searchQuery';
import { ErrorState } from '@/components/StateDisplay';
import { WorkItemsGrid } from './WorkItemsGrid';
import { WorkItemTemplatesPanel } from './WorkItemTemplatesPanel';
import { workItemQueryKeys } from './queryKeys';

const PRIORITY_REFERENCE_NAME = "Microsoft.VSTS.Common.Priority";
const TAGS_REFERENCE_NAME = "System.Tags";

function extraFieldValue(item: WorkItemSummary, referenceName: string): string | null {
  return (
    item.extraFields.find(
      (field) => field.referenceName.toLowerCase() === referenceName.toLowerCase(),
    )?.value ?? null
  );
}

function toMatchTarget(item: WorkItemSummary): WorkItemMatchTarget {
  const priorityRaw = extraFieldValue(item, PRIORITY_REFERENCE_NAME);
  const priority = priorityRaw !== null && priorityRaw.trim() !== "" ? Number(priorityRaw) : NaN;
  const tagsRaw = extraFieldValue(item, TAGS_REFERENCE_NAME);
  return {
    id: item.id,
    title: item.title,
    workItemType: item.workItemType,
    state: item.state,
    assignedTo: item.assignedTo,
    projectName: item.projectName,
    priority: Number.isFinite(priority) ? priority : null,
    tags: tagsRaw ? tagsRaw.split(";").map((tag) => tag.trim()).filter(Boolean) : [],
  };
}

export function MyWorkItemsPanel({ organizations }: { organizations: Organization[] }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [filter, setFilter] = useState("");

  const selectedOrganizationId = organizationId || organizations[0]?.id || "";

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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
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

        {organizations.length > 1 ? (
          <select
            value={selectedOrganizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
            aria-label="Organization"
            className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        ) : null}

        <WorkItemTemplatesPanel />
      </div>
      {query.isError ? (
        <ErrorState message={commandErrorMessage(query.error)} />
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
    </div>
  );
}
