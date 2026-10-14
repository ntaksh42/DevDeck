import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getActionInboxCounts, listActionInboxItems } from "@/lib/azdoCommands";
import { matchesInboxFilter, type InboxEntry, type InboxTab } from "./inboxPresentation";

/** Sidebar badge: the number of open Inbox items, the same count the Inbox lists. */
export function useInboxBadge(): number | null {
  const counts = useQuery({
    queryKey: ["actionInbox", "counts"],
    queryFn: () => getActionInboxCounts(),
    staleTime: 30_000,
  });
  return counts.data?.open ?? null;
}

/** The rows of the Inbox for one tab, filtered by the text filter. */
export function useInboxEntries({
  tab,
  organizationId,
  filterText,
}: {
  tab: InboxTab;
  organizationId: string;
  filterText: string;
}) {
  const listQuery = useQuery({
    queryKey: ["actionInbox", "list", tab, organizationId],
    queryFn: () =>
      listActionInboxItems({ state: tab, organizationId: organizationId || undefined }),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  const entries = useMemo<InboxEntry[]>(
    () => (listQuery.data ?? []).filter((entry) => matchesInboxFilter(entry, filterText)),
    [listQuery.data, filterText],
  );

  return {
    entries,
    isLoading: listQuery.isLoading,
    error: listQuery.isError ? listQuery.error : null,
    refetch: () => void listQuery.refetch(),
  };
}
