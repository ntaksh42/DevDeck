import { useEffect } from 'react';
import { useQueries } from '@tanstack/react-query';
import { countWorkItemQuery, type WorkItemProjectOption } from '@/lib/azdoCommands';
import { workItemQueryKeys } from './queryKeys';
import { recordViewCount, type WorkItemQueryView } from './workItemViewsStorage';
import { recordViewCountHistory } from './workItemViewsDisplayStorage';

type UseViewCountQueriesParams = {
  views: WorkItemQueryView[];
  selectedOrganizationId: string;
  projectOptions: WorkItemProjectOption[];
};

/**
 * Runs one count query per saved view and records each result twice: as the
 * baseline the delta badge compares against, and as a point in the history the
 * card sparkline draws.
 */
export function useViewCountQueries({
  views,
  selectedOrganizationId,
  projectOptions,
}: UseViewCountQueriesParams) {
  const viewCountQueries = useQueries({
    queries: views.map((view) => ({
      queryKey: workItemQueryKeys.queryCount({
        organizationId: selectedOrganizationId,
        viewId: view.id,
        projectId: view.projectId || projectOptions[0]?.projectId,
        wiql: view.wiql,
        limit: view.limit,
      }),
      queryFn: () =>
        countWorkItemQuery({
          organizationId: selectedOrganizationId,
          projectId: view.projectId || projectOptions[0]?.projectId || "",
          wiql: view.wiql,
          limit: view.limit,
        }),
      enabled:
        !!selectedOrganizationId &&
        !!(view.projectId || projectOptions[0]?.projectId) &&
        !!view.wiql.trim(),
      staleTime: 5 * 60_000,
      refetchInterval: view.refreshIntervalSec ? view.refreshIntervalSec * 1000 : (false as const),
    })),
  });

  const viewCountsSignature = views
    .map((view, index) => `${view.id}:${viewCountQueries[index]?.data ?? ""}`)
    .join("|");
  useEffect(() => {
    const ids = views.map((view) => view.id);
    views.forEach((view, index) => {
      const count = viewCountQueries[index]?.data;
      if (typeof count !== "number") return;
      recordViewCount(view.id, count, ids);
      recordViewCountHistory(view.id, count, ids);
    });
    // viewCountQueries is a fresh array each render; the signature captures the inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewCountsSignature]);

  return viewCountQueries;
}
