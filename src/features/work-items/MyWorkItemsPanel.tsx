import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { listMyWorkItems, commandErrorMessage, type Organization } from '@/lib/azdoCommands';
import { matchesAllSearchTerms, splitSearchTerms } from '@/lib/utils';
import { ErrorState } from '@/components/StateDisplay';
import { WorkItemsGrid } from './WorkItemsGrid';
import { SprintProgressBar } from './SprintProgressBar';
import { workItemQueryKeys } from './queryKeys';

export function MyWorkItemsPanel({ organizations }: { organizations: Organization[] }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [filter, setFilter] = useState("");
  const [iterationIds, setIterationIds] = useState<Set<number> | null>(null);

  const selectedOrganizationId = organizationId || organizations[0]?.id || "";

  const query = useQuery({
    queryKey: workItemQueryKeys.myItems(selectedOrganizationId),
    queryFn: () => listMyWorkItems({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
    staleTime: 5 * 60_000,
  });

  const allResults = query.data ?? [];

  // The sprint bar is scoped to a single team's iteration; pick the project
  // that owns the most of my work items as the representative team.
  const dominantProjectId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of allResults) {
      counts.set(item.projectId, (counts.get(item.projectId) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [projectId, count] of counts) {
      if (count > bestCount) {
        best = projectId;
        bestCount = count;
      }
    }
    return best;
  }, [allResults]);

  const results = useMemo(() => {
    const scoped = iterationIds
      ? allResults.filter((item) => iterationIds.has(item.id))
      : allResults;
    const terms = splitSearchTerms(filter);
    if (terms.length === 0) return scoped;
    return scoped.filter((item) => {
      const freeTerms: string[] = [];
      for (const term of terms) {
        const [key, ...rest] = term.split(":");
        const value = rest.join(":");
        if (!value || !["state", "type", "project", "assignee", "tag"].includes(key)) {
          freeTerms.push(term);
          continue;
        }
        const target =
          key === "state"
            ? item.state
            : key === "type"
              ? item.workItemType
              : key === "project"
                ? item.projectName
                : key === "assignee"
                  ? item.assignedTo
                  : "";
        if (!String(target ?? "").toLowerCase().includes(value)) return false;
      }
      return matchesAllSearchTerms(freeTerms, [
        item.id,
        item.title,
        item.workItemType,
        item.state,
        item.projectName,
        item.assignedTo,
      ]);
    });
  }, [allResults, filter, iterationIds]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="flex h-8 min-w-[180px] flex-1 items-center rounded-md border border-input bg-background px-2 focus-within:ring-2 focus-within:ring-ring">
          <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter work items…"
            aria-label="Filter"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>

        <SprintProgressBar
          organizationId={selectedOrganizationId}
          projectId={dominantProjectId}
          active={iterationIds !== null}
          onToggle={(progress) =>
            setIterationIds((current) =>
              current ? null : new Set(progress.workItemIds),
            )
          }
        />

        {organizations.length > 1 ? (
          <select
            value={selectedOrganizationId}
            onChange={(event) => {
              setOrganizationId(event.target.value);
              setIterationIds(null);
            }}
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

      </div>
      {query.isError ? (
        <ErrorState message={commandErrorMessage(query.error)} />
      ) : null}

      <WorkItemsGrid
        activeExternalFilterCount={(filter.trim() ? 1 : 0) + (iterationIds ? 1 : 0)}
        dataUpdatedAt={query.dataUpdatedAt}
        loading={query.isFetching && query.data === undefined}
        onClearExternalFilters={() => {
          setFilter("");
          setIterationIds(null);
        }}
        results={results}
        searched={query.isSuccess || query.isFetching}
        autoFocus
        triageScope={`myWorkItems:${selectedOrganizationId}`}
        snoozeOrganizationId={selectedOrganizationId}
      />
    </div>
  );
}
