import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getActionInboxCounts, listActionInboxItems } from "@/lib/azdoCommands";
import { matchesInboxFilter, matchesInboxPriority, type InboxEntry, type InboxPriority, type InboxTab } from "./inboxPresentation";

/** Sidebar badge: the number of open Inbox items, the same count the Inbox lists. */
export function useInboxBadge(): number | null {
  const counts = useQuery({
    queryKey: ["actionInbox", "counts"],
    queryFn: () => getActionInboxCounts(),
    staleTime: 30_000,
  });
  return counts.data?.open ?? null;
}

/** The rows of the Inbox for one tab, filtered by text and priority. */
export function useInboxEntries({
  tab,
  organizationId,
  filterText,
  priority,
}: {
  tab: InboxTab;
  organizationId: string;
  filterText: string;
  priority: InboxPriority;
}) {
  const listQuery = useQuery({
    queryKey: ["actionInbox", "list", tab, organizationId],
    queryFn: () =>
      listActionInboxItems({ state: tab, organizationId: organizationId || undefined }),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  const textMatches = useMemo<InboxEntry[]>(
    () => (listQuery.data ?? []).filter((entry) => matchesInboxFilter(entry, filterText)),
    [listQuery.data, filterText],
  );
  const entries = useMemo(
    () => textMatches.filter((entry) => matchesInboxPriority(entry, priority)),
    [textMatches, priority],
  );
  /** Rows per priority tab for the current text filter. */
  const priorityCounts = useMemo<Record<InboxPriority, number>>(() => {
    const mentions = textMatches.filter((entry) => matchesInboxPriority(entry, "priority")).length;
    return { priority: mentions, other: textMatches.length - mentions, all: textMatches.length };
  }, [textMatches]);

  return {
    entries,
    priorityCounts,
    isLoading: listQuery.isLoading,
    error: listQuery.isError ? listQuery.error : null,
    refetch: () => void listQuery.refetch(),
  };
}
