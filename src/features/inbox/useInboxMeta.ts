import { useQuery } from "@tanstack/react-query";
import { getActionInboxCounts, getAppSettings, listOrganizations } from "@/lib/azdoCommands";
import type { InboxTab } from "./inboxPresentation";

/** Organizations, the settings the Inbox reads, and the per-tab counts. */
export function useInboxMeta(organizationId: string) {
  const organizationsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: listOrganizations,
    staleTime: 5 * 60_000,
  });
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const countsQuery = useQuery({
    queryKey: ["actionInbox", "counts", organizationId],
    queryFn: () => getActionInboxCounts(organizationId || undefined),
    staleTime: 15_000,
  });
  const counts = countsQuery.data ?? { open: 0, snoozed: 0, done: 0 };
  const tabCounts: Record<InboxTab, number> = {
    open: counts.open,
    snoozed: counts.snoozed,
    done: counts.done,
  };
  return {
    organizations: organizationsQuery.data ?? [],
    readOnly: settingsQuery.data?.readOnlyValidationModeEnabled ?? false,
    insightEnabled: settingsQuery.data?.inboxInsightEnabled ?? false,
    tabCounts,
  };
}
