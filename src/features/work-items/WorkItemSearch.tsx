import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Info, Loader2, Search } from "lucide-react";
import {
  searchWorkItems,
  listWorkItemProjects,
  commandErrorMessage,
  type Organization,
} from "@/lib/azdoCommands";
import { ErrorState } from "@/components/StateDisplay";
import { WorkItemsGrid } from "./WorkItemsGrid";
import { workItemQueryKeys } from "./queryKeys";

export function WorkItemSearch({
  organizations,
  externalSearch,
  onExternalSearchHandled,
}: {
  organizations: Organization[];
  externalSearch?: { query: string; requestId: number; organizationId?: string } | null;
  onExternalSearchHandled?: () => void;
}) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [state, setState] = useState("all");
  const [workItemType, setWorkItemType] = useState("");
  const [projectId, setProjectId] = useState("");

  const projectsQuery = useQuery({
    queryKey: workItemQueryKeys.searchProjects(organizationId),
    queryFn: () => listWorkItemProjects({ organizationId }),
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
  });
  const projects = projectsQuery.data ?? [];

  const mutation = useMutation({ mutationFn: searchWorkItems });
  const results = mutation.data?.items ?? [];
  const truncated = mutation.data?.truncated ?? false;

  useEffect(() => {
    if (!externalSearch) return;
    const targetOrganizationId = externalSearch.organizationId ?? organizationId;
    setOrganizationId(targetOrganizationId);
    setQuery(externalSearch.query);
    setState("all");
    setWorkItemType("");
    setProjectId("");
    mutation.mutate({
      organizationId: targetOrganizationId,
      query: externalSearch.query,
      state: "all",
      workItemType: "",
      projectId: undefined,
    });
    onExternalSearchHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSearch?.requestId]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate({
      organizationId,
      query,
      state,
      workItemType,
      projectId: projectId || undefined,
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <form className="flex shrink-0 flex-wrap items-center gap-2" onSubmit={onSubmit}>
        {organizations.length > 1 && (
          <select
            value={organizationId}
            onChange={(e) => { setOrganizationId(e.target.value); setProjectId(""); }}
            aria-label="Organization"
            className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        )}
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
        <select
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          disabled={projectsQuery.isLoading}
          aria-label="Project"
          className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.projectId} value={p.projectId}>{p.projectName}</option>
          ))}
        </select>
        <select
          value={state}
          onChange={(event) => setState(event.target.value)}
          aria-label="State"
          className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">All states</option>
          <option value="New">New</option>
          <option value="Active">Active</option>
          <option value="Resolved">Resolved</option>
          <option value="Closed">Closed</option>
        </select>
        <select
          value={workItemType}
          onChange={(event) => setWorkItemType(event.target.value)}
          aria-label="Type"
          className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Any type</option>
          <option value="Bug">Bug</option>
          <option value="Epic">Epic</option>
          <option value="Feature">Feature</option>
          <option value="Task">Task</option>
          <option value="User Story">User Story</option>
          <option value="Test Case">Test Case</option>
        </select>
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

      <p className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        Showing locally synced data — refreshed automatically every 5 minutes.
      </p>

      {mutation.isError ? (
        <ErrorState message={commandErrorMessage(mutation.error)} />
      ) : null}

      {truncated ? (
        <p className="flex shrink-0 items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500">
          <Info className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          Showing the first {results.length} matches. Add filters or a search term to narrow the results.
        </p>
      ) : null}

      <WorkItemsGrid loading={mutation.isPending} results={results} searched={mutation.isSuccess} />
    </div>
  );
}
