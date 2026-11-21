import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCachedWorkItemQuery, runWorkItemQuery } from '@/lib/azdoCommands';
import { workItemQueryKeys } from './queryKeys';
import type { WorkItemQueryView } from './workItemViewsStorage';

type Options = {
  organizationId?: string;
  view: WorkItemQueryView | null;
  projectId: string;
  extraColumns: string[];
};

/**
 * Runs the selected view's WIQL. Until the first answer arrives, the rows this
 * query returned last time (persisted in SQLite, so they survive a restart)
 * are shown as placeholder data, and `dataUpdatedAt` reports when they were fetched.
 */
export function useWorkItemViewQuery({ organizationId, view, projectId, extraColumns }: Options) {
  const queryClient = useQueryClient();
  const keyInput = {
    organizationId,
    viewId: view?.id,
    projectId,
    wiql: view?.wiql,
    limit: view?.limit,
    extraFieldsSignature: extraColumns.join('|'),
  };
  const commandInput = view
    ? { organizationId, projectId, wiql: view.wiql, limit: view.limit, extraFields: extraColumns }
    : null;
  const enabled = !!view && !!organizationId && !!projectId && !!view.wiql.trim();
  const cacheKey = workItemQueryKeys.queryViewCache(keyInput);

  const cached = useQuery({
    queryKey: cacheKey,
    queryFn: () => getCachedWorkItemQuery(commandInput!),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
  const cachedItems = cached.data?.items;

  const query = useQuery({
    queryKey: workItemQueryKeys.queryView(keyInput),
    queryFn: async () => {
      const items = await runWorkItemQuery(commandInput!);
      // Keep the persisted copy in step so a later placeholder is never older
      // than what this session already showed.
      queryClient.setQueryData(cacheKey, { items, fetchedAt: new Date().toISOString() });
      return items;
    },
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    // Adding/removing an extra column changes the key; keep the same view's
    // rows on screen so the grid (and its focus) isn't swapped for a spinner.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === view?.id && previous ? previous : cachedItems,
    refetchInterval: view?.refreshIntervalSec ? view.refreshIntervalSec * 1000 : false,
  });

  const showingCached =
    query.isPlaceholderData && !!cachedItems && query.data === cachedItems;
  const dataUpdatedAt = showingCached
    ? Date.parse(cached.data!.fetchedAt) || undefined
    : query.dataUpdatedAt;
  return { query, dataUpdatedAt };
}
