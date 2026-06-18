import { useEffect, useState, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import {
  listMyWorkItems,
  listWorkItemProjects,
  getAppSettings,
  commandErrorMessage,
  type Organization,
} from '@/lib/azdoCommands';
import { isEditableTarget, matchesAllSearchTerms, splitSearchTerms } from '@/lib/utils';
import { ErrorState } from '@/components/StateDisplay';
import { WorkItemsGrid } from './WorkItemsGrid';
import { NewWorkItemDialog } from './NewWorkItemDialog';
import { workItemQueryKeys } from './queryKeys';

export function MyWorkItemsPanel({ organizations }: { organizations: Organization[] }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [filter, setFilter] = useState("");
  const [createProjectId, setCreateProjectId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const selectedOrganizationId = organizationId || organizations[0]?.id || "";

  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 60_000,
  });
  const readOnly = settingsQuery.data?.readOnlyValidationModeEnabled ?? false;

  const query = useQuery({
    queryKey: workItemQueryKeys.myItems(selectedOrganizationId),
    queryFn: () => listMyWorkItems({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
    staleTime: 5 * 60_000,
  });

  const projectsQuery = useQuery({
    queryKey: workItemQueryKeys.searchProjects(selectedOrganizationId),
    queryFn: () => listWorkItemProjects({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId && !readOnly,
    staleTime: 5 * 60_000,
  });
  const projects = projectsQuery.data ?? [];

  // Default the create target to the first project for the selected org.
  useEffect(() => {
    if (projects.length === 0) {
      setCreateProjectId("");
      return;
    }
    setCreateProjectId((current) =>
      projects.some((project) => project.projectId === current)
        ? current
        : projects[0].projectId,
    );
  }, [projects]);

  const canCreate = !readOnly && !!selectedOrganizationId && projects.length > 0;

  function openCreate() {
    if (canCreate) setShowCreate(true);
  }

  function closeCreate() {
    setShowCreate(false);
    // Return focus to the panel so keyboard grid navigation resumes.
    window.setTimeout(() => containerRef.current?.focus(), 0);
  }

  const allResults = query.data ?? [];
  const results = useMemo(() => {
    const terms = splitSearchTerms(filter);
    if (terms.length === 0) return allResults;
    return allResults.filter((item) => {
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
  }, [allResults, filter]);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="flex min-h-0 flex-1 flex-col gap-3 outline-none"
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        if (isEditableTarget(event.target)) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if ((event.key === "n" || event.key === "N") && canCreate && !showCreate) {
          event.preventDefault();
          openCreate();
        }
      }}
    >
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

        {!readOnly ? (
          <>
            {projects.length > 1 ? (
              <select
                value={createProjectId}
                onChange={(event) => setCreateProjectId(event.target.value)}
                aria-label="New work item project"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {projects.map((project) => (
                  <option key={project.projectId} value={project.projectId}>
                    {project.projectName}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              onClick={openCreate}
              disabled={!canCreate}
              title="New work item (N)"
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New
            </button>
          </>
        ) : null}
      </div>
      {query.isError ? (
        <ErrorState message={commandErrorMessage(query.error)} />
      ) : null}

      <WorkItemsGrid
        activeExternalFilterCount={filter.trim() ? 1 : 0}
        dataUpdatedAt={query.dataUpdatedAt}
        loading={query.isFetching && query.data === undefined}
        onClearExternalFilters={() => setFilter("")}
        results={results}
        searched={query.isSuccess || query.isFetching}
        autoFocus
        triageScope={`myWorkItems:${selectedOrganizationId}`}
        snoozeOrganizationId={selectedOrganizationId}
      />

      {showCreate && canCreate ? (
        <NewWorkItemDialog
          organizationId={selectedOrganizationId}
          projectId={createProjectId}
          onClose={closeCreate}
          onCreated={() => {
            // The created item carries the newest changedDate, so the default
            // changedDate-desc sort surfaces it at the top of the grid and the
            // preview pane opens it once My Work Items refetches.
            setFilter("");
            closeCreate();
          }}
        />
      ) : null}
    </div>
  );
}
