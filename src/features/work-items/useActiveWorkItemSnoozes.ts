import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listSnoozedItems } from "@/lib/azdoCommands";
import { activeSnoozedKeys } from "@/lib/snoozePresets";

export function useActiveWorkItemSnoozes(organizationId?: string): Set<string> {
  const query = useQuery({
    queryKey: ["snoozedItems", "work_item", organizationId],
    queryFn: () => listSnoozedItems({ organizationId, itemType: "work_item" }),
    enabled: !!organizationId,
    staleTime: 60_000,
  });
  return useMemo(() => activeSnoozedKeys(query.data ?? []), [query.data]);
}
