import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWorkItemExtraFields, type WorkItemSummary } from "@/lib/azdoCommands";
import { workItemQueryKeys } from "./queryKeys";
import { extraColumnReferenceNames, type ExtraColumn } from "./extraColumns";

/** Work items fetched per request; enough to cover a long scroll session. */
const MAX_EXTRA_FIELD_ROWS = 500;

/**
 * Fills in extra field values for rows that came from the SQLite cache.
 *
 * The cache only holds the standard columns, so Search and My Work Items would
 * otherwise show every extra column as empty. Rather than widening the sync
 * scope, the values are fetched on demand for the rows currently in hand and
 * merged into each summary's `extraFields`.
 */
export function useExtraColumnValues({
  organizationId,
  results,
  extraColumns,
}: {
  organizationId: string | undefined;
  results: WorkItemSummary[];
  extraColumns: ExtraColumn[];
}): { results: WorkItemSummary[]; loading: boolean; error: unknown } {
  const referenceNames = useMemo(
    () => extraColumnReferenceNames(extraColumns),
    [extraColumns],
  );
  const targets = useMemo(
    () =>
      results
        .slice(0, MAX_EXTRA_FIELD_ROWS)
        .map((item) => ({ projectId: item.projectId, id: item.id })),
    [results],
  );
  const targetsSignature = useMemo(
    () => targets.map((target) => `${target.projectId}:${target.id}`).join("|"),
    [targets],
  );
  const fieldsSignature = referenceNames.join("|");
  const enabled = referenceNames.length > 0 && targets.length > 0 && !!organizationId;

  const query = useQuery({
    queryKey: workItemQueryKeys.extraFields(
      organizationId,
      targetsSignature,
      fieldsSignature,
    ),
    queryFn: () =>
      fetchWorkItemExtraFields({
        organizationId,
        items: targets,
        extraFields: referenceNames,
      }),
    enabled,
    staleTime: 60_000,
  });

  const merged = useMemo(() => {
    const fetched = query.data;
    if (!enabled || !fetched || fetched.length === 0) return results;
    const byId = new Map(fetched.map((row) => [row.id, row.extraFields]));
    return results.map((item) => {
      const extraFields = byId.get(item.id);
      return extraFields ? { ...item, extraFields } : item;
    });
  }, [enabled, query.data, results]);

  return {
    results: merged,
    loading: enabled && query.isFetching,
    error: query.isError ? query.error : null,
  };
}
