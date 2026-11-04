import { useQuery } from "@tanstack/react-query";
import { listSyncStates } from "@/lib/azdoCommands";

/**
 * Warning text when the last Inbox scan left comments out (PRs over the scan
 * limit, or the work item mention query rejected). It comes from Sync health
 * (`inbox_prs:*` / `inbox_wi:*`); null when every scan was complete.
 */
export function useInboxScanLimit(): string | null {
  const { data } = useQuery({
    queryKey: ["syncStates"],
    queryFn: listSyncStates,
    staleTime: 30_000,
  });
  const warnings = (data ?? [])
    .filter((state) => state.scope.startsWith("inbox_") && state.lastWarning)
    .map((state) => state.lastWarning as string);
  return warnings.length > 0 ? [...new Set(warnings)].join("\n") : null;
}
