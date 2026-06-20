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
import {
  dueBucketCounts,
  dueBucketOf,
  DUE_BUCKET_LABELS,
  DUE_BUCKET_ORDER,
  type DueBucket,
} from './dueGrouping';

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
  const [dueBucket, setDueBucket] = useState<DueBucket | null>(null);

  const selectedOrganizationId = organizationId || organizations[0]?.id || "";

  const query = useQuery({
    queryKey: workItemQueryKeys.myItems(selectedOrganizationId),
    queryFn: () => listMyWorkItems({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
    staleTime: 5 * 60_000,
  });

  const allResults = query.data ?? [];
  // Text/smart-search filtered set, used both for the due-bucket counts and as
  // the base the bucket filter narrows further.
  const textFiltered = useMemo(() => {
    const parsed = parseSearchQuery(filter);
    if (parsed.filters.length === 0 && parsed.text.length === 0) return allResults;
    return allResults.filter((item) => matchesWorkItemQuery(toMatchTarget(item), parsed));
  }, [allResults, filter]);

  const bucketCounts = useMemo(() => dueBucketCounts(textFiltered), [textFiltered]);

  const results = useMemo(() => {
    if (!dueBucket) return textFiltered;
    return textFiltered.filter((item) => dueBucketOf(item.dueDate) === dueBucket);
  }, [textFiltered, dueBucket]);

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

      {/* Due-date grouping: click a bucket to focus it; Overdue is highlighted. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5" role="group" aria-label="Group by due date">
        <span className="text-xs font-medium text-muted-foreground">Due</span>
        {DUE_BUCKET_ORDER.map((bucket) => {
          const active = dueBucket === bucket;
          const overdue = bucket === "overdue";
          const tone = active
            ? overdue
              ? "border-red-500 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200"
              : "border-primary bg-secondary text-foreground"
            : overdue && bucketCounts[bucket] > 0
              ? "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
              : "border-border text-muted-foreground hover:bg-secondary";
          return (
            <button
              key={bucket}
              type="button"
              aria-pressed={active}
              onClick={() => setDueBucket((current) => (current === bucket ? null : bucket))}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${tone}`}
            >
              <span>{DUE_BUCKET_LABELS[bucket]}</span>
              <span className="rounded bg-background/70 px-1 font-semibold tabular-nums">
                {bucketCounts[bucket]}
              </span>
            </button>
          );
        })}
      </div>

      {query.isError ? (
        <ErrorState message={commandErrorMessage(query.error)} />
      ) : null}

      <WorkItemsGrid
        activeExternalFilterCount={(filter.trim() ? 1 : 0) + (dueBucket ? 1 : 0)}
        dataUpdatedAt={query.dataUpdatedAt}
        isFetching={query.isFetching && query.data !== undefined}
        loading={query.isFetching && query.data === undefined}
        onClearExternalFilters={() => {
          setFilter("");
          setDueBucket(null);
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
