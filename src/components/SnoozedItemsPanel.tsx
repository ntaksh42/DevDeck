import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import {
  commandErrorMessage,
  listSnoozedItems,
  unsnoozeItem,
  type SnoozeItemType,
} from "@/lib/azdoCommands";
import { formatSnoozeUntil } from "@/lib/snoozePresets";
import { openExternalUrl } from "@/lib/openExternal";
import { LoadingState, ErrorState } from "@/components/StateDisplay";

// List of items the user has snoozed for the given type, with an unsnooze
// action. Unsnoozing invalidates both the snoozed list and the owning grid's
// query so the row reappears immediately.
export function SnoozedItemsPanel({
  organizationId,
  itemType,
  onUnsnoozed,
}: {
  organizationId: string;
  itemType: SnoozeItemType;
  // Invalidate the owning grid's query so the unsnoozed row reappears.
  onUnsnoozed: () => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["snoozedItems", itemType, organizationId],
    queryFn: () => listSnoozedItems({ organizationId, itemType }),
    enabled: !!organizationId,
    staleTime: 60_000,
  });

  const unsnooze = useMutation({
    mutationFn: (itemKey: string) =>
      unsnoozeItem({ organizationId, itemType, itemKey }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["snoozedItems", itemType],
      });
      onUnsnoozed();
    },
  });

  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState message={commandErrorMessage(query.error)} onRetry={() => void query.refetch()} />;

  const items = query.data ?? [];
  if (items.length === 0) {
    return (
      <div className="flex min-h-24 flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
        <Clock className="h-5 w-5" aria-hidden="true" />
        <span>No snoozed items.</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {items.map((item) => (
        <div
          key={item.itemKey}
          className="flex items-center gap-2 border-b border-border px-2 py-1.5 text-sm hover:bg-muted/50"
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <button
              type="button"
              onClick={() => {
                if (item.webUrl) openExternalUrl(item.webUrl);
              }}
              disabled={!item.webUrl}
              className="truncate text-left font-medium text-foreground hover:underline disabled:cursor-default disabled:no-underline"
              title={item.title ?? item.itemKey}
            >
              {item.title ?? item.itemKey}
            </button>
            <span className="truncate text-xs text-muted-foreground">
              {item.subtitle ? `${item.subtitle} · ` : ""}
              Until {formatSnoozeUntil(item.snoozeUntil)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => unsnooze.mutate(item.itemKey)}
            disabled={unsnooze.isPending}
            className="shrink-0 rounded border border-border bg-card px-2 py-0.5 text-xs hover:bg-secondary disabled:opacity-50"
          >
            Unsnooze
          </button>
        </div>
      ))}
    </div>
  );
}
