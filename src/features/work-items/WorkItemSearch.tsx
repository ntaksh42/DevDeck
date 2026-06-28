import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Info, Loader2, Search } from "lucide-react";
import {
  searchWorkItems,
  listWorkItemProjects,
  commandErrorMessage,
} from "@/lib/azdoCommands";
import { useActiveOrganizationId } from "@/lib/useActiveConnection";
import { matchesWorkItemQuery, parseSearchQuery } from "@/lib/searchQuery";
import { ErrorState } from "@/components/StateDisplay";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { WorkItemsGrid } from "./WorkItemsGrid";
import { toMatchTarget } from "./workItemMatchTarget";
import { workItemQueryKeys } from "./queryKeys";

const WORK_ITEM_STATE_OPTIONS = ["New", "Active", "Resolved", "Closed"].map(
  (value) => ({ value, label: value }),
);
const WORK_ITEM_TYPE_OPTIONS = [
  "Bug",
  "Epic",
  "Feature",
  "Task",
  "User Story",
  "Test Case",
].map((value) => ({ value, label: value }));

export function WorkItemSearch({
  externalSearch,
  onExternalSearchHandled,
}: {
  externalSearch?: { query: string; requestId: number; organizationId?: string } | null;
  onExternalSearchHandled?: () => void;
}) {
  const organizationId = useActiveOrganizationId();
  const [query, setQuery] = useState("");
  const [states, setStates] = useState<string[]>([]);
  const [workItemTypes, setWorkItemTypes] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);

  const projectsQuery = useQuery({
    queryKey: workItemQueryKeys.searchProjects(organizationId),
    queryFn: () => listWorkItemProjects({ organizationId }),
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
  });
  const projects = projectsQuery.data ?? [];

  const [resultFilter, setResultFilter] = useState("");

  const mutation = useMutation({ mutationFn: searchWorkItems });
  const results = mutation.data ?? [];
  // Client-side smart filtering over the server results, matching My Work Items
  // (#1234, p:1, @user, s:active, t:bug). Empty filter keeps every row.
  const filteredResults = useMemo(() => {
    const parsed = parseSearchQuery(resultFilter);
    if (parsed.filters.length === 0 && parsed.text.length === 0) return results;
    return results.filter((item) => matchesWorkItemQuery(toMatchTarget(item), parsed));
  }, [results, resultFilter]);

  useEffect(() => {
    if (!externalSearch) return;
    const targetOrganizationId = organizationId;
    setQuery(externalSearch.query);
    setStates([]);
    setWorkItemTypes([]);
    setProjectIds([]);
    mutation.mutate({
      organizationId: targetOrganizationId,
      query: externalSearch.query,
      states: undefined,
      workItemTypes: undefined,
      projectIds: undefined,
    });
    onExternalSearchHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSearch?.requestId]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate({
      organizationId,
      query,
      states: states.length > 0 ? states : undefined,
      workItemTypes: workItemTypes.length > 0 ? workItemTypes : undefined,
      projectIds: projectIds.length > 0 ? projectIds : undefined,
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <form className="flex shrink-0 flex-wrap items-center gap-2" onSubmit={onSubmit}>
        <div className="flex h-8 min-w-[180px] flex-1 items-center rounded-md border border-input bg-background px-2 focus-within:ring-2 focus-within:ring-ring">
          <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search work items…"
            aria-label="Search"
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <div className="w-44">
          <MultiSelectFilter
            options={projects.map((p) => ({ value: p.projectId, label: p.projectName }))}
            selected={projectIds}
            onChange={setProjectIds}
            placeholder="All projects"
            ariaLabel="Filter by project"
            searchable
            disabled={projectsQuery.isLoading}
            className="h-8"
          />
        </div>
        <div className="w-36">
          <MultiSelectFilter
            options={WORK_ITEM_STATE_OPTIONS}
            selected={states}
            onChange={setStates}
            placeholder="All states"
            ariaLabel="Filter by state"
            className="h-8"
          />
        </div>
        <div className="w-36">
          <MultiSelectFilter
            options={WORK_ITEM_TYPE_OPTIONS}
            selected={workItemTypes}
            onChange={setWorkItemTypes}
            placeholder="Any type"
            ariaLabel="Filter by type"
            className="h-8"
          />
        </div>
        <button
          type="submit"
          disabled={mutation.isPending || !organizationId}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {mutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Search
        </button>
      </form>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          Showing locally synced data — refreshed automatically every 5 minutes.
        </p>
        {mutation.isSuccess ? (
          <div className="flex h-7 min-w-[180px] items-center rounded-md border border-input bg-background px-2 focus-within:ring-2 focus-within:ring-ring">
            <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              value={resultFilter}
              onChange={(event) => setResultFilter(event.target.value)}
              placeholder="Filter results… #1234, p:1, @user, s:active, t:bug"
              aria-label="Filter results"
              title="Smart filter: #1234 id, p:1–4 priority, @user assignee, s:active state, t:bug type. Unknown prefixes are searched as text."
              className="min-w-0 flex-1 bg-transparent text-xs outline-none"
            />
          </div>
        ) : null}
      </div>

      {mutation.isError ? (
        <ErrorState message={commandErrorMessage(mutation.error)} />
      ) : null}

      <WorkItemsGrid loading={mutation.isPending} results={filteredResults} searched={mutation.isSuccess} />
    </div>
  );
}
