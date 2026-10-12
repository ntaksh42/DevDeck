import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listSnoozedItems, type SnoozeItemType } from "@/lib/azdoCommands";
import { activeSnoozedKeys } from "@/lib/snoozePresets";

/** Active snoozed items of a type; shares the cache key with `SnoozedItemsPanel`. */
export function useSnoozedCount(itemType: SnoozeItemType, organizationId: string): number {
  const query = useQuery({
    queryKey: ["snoozedItems", itemType, organizationId],
    queryFn: () => listSnoozedItems({ organizationId, itemType }),
    enabled: !!organizationId,
    staleTime: 60_000,
  });
  return useMemo(() => activeSnoozedKeys(query.data ?? []).size, [query.data]);
}
