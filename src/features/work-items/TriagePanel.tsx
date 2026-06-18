import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { listMyWorkItems, commandErrorMessage, type Organization } from "@/lib/azdoCommands";
import { ErrorState } from "@/components/StateDisplay";
import { WorkItemsGrid } from "./WorkItemsGrid";
import { workItemQueryKeys } from "./queryKeys";
import { filterTriageWorkItems } from "./triageFilter";

export function TriagePanel({ organizations }: { organizations: Organization[] }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const selectedOrganizationId = organizationId || organizations[0]?.id || "";

  const query = useQuery({
    queryKey: workItemQueryKeys.myItems(selectedOrganizationId),
    queryFn: () => listMyWorkItems({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
    staleTime: 5 * 60_000,
  });

  const triageItems = useMemo(
    () => filterTriageWorkItems(query.data ?? []),
    [query.data],
  );

  const settled = query.isSuccess && !query.isFetching;
  const allTriaged = settled && triageItems.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          Active items missing an assignee or a priority. Press{" "}
          <kbd className="rounded border border-border bg-muted px-1 text-xs">A</kbd> to assign,{" "}
          <kbd className="rounded border border-border bg-muted px-1 text-xs">P</kbd> to set
          priority, <kbd className="rounded border border-border bg-muted px-1 text-xs">S</kbd> to
          change state.
        </p>

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
      </div>

      {query.isError ? <ErrorState message={commandErrorMessage(query.error)} /> : null}

      {allTriaged ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-500" aria-hidden="true" />
          <p className="text-base font-medium text-foreground">All triaged! 🎉</p>
          <p className="text-sm text-muted-foreground">
            Every active item has an assignee and a priority.
          </p>
        </div>
      ) : (
        <WorkItemsGrid
          dataUpdatedAt={query.dataUpdatedAt}
          loading={query.isFetching && query.data === undefined}
          results={triageItems}
          searched={query.isSuccess || query.isFetching}
          autoFocus
          storageKeyScope="triage"
        />
      )}
    </div>
  );
}
