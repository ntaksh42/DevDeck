import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listWorkItemFields } from "@/lib/azdoCommands";
import { workItemQueryKeys } from "./queryKeys";
import { extraColumnLabel } from "./workItemsGridHelpers";

/** Organization-wide Azure DevOps field definitions (shared cache with the Columns menu). */
export function useWorkItemFields(organizationId: string | undefined) {
  return useQuery({
    queryKey: workItemQueryKeys.fields(organizationId, null),
    queryFn: () => listWorkItemFields({ organizationId, projectId: "" }),
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
  });
}

/**
 * Resolves a field reference name to the display name Azure DevOps shows,
 * falling back to the reference name's last segment until (or unless) the
 * definitions load.
 */
export function useExtraColumnLabel(organizationId: string | undefined) {
  const { data } = useWorkItemFields(organizationId);
  const names = useMemo(
    () => new Map((data ?? []).map((field) => [field.referenceName.toLowerCase(), field.name])),
    [data],
  );
  return useCallback(
    (referenceName: string) => names.get(referenceName.toLowerCase()) ?? extraColumnLabel(referenceName),
    [names],
  );
}
