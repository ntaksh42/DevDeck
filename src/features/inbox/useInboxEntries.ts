import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getActionInboxCounts, listActionInboxItems } from "@/lib/azdoCommands";
import { applyColumnFilters, columnFilterUniqueValues } from "@/lib/columnFilters";
import { INBOX_FILTERABLE_COLUMNS, type InboxFilterColumn } from "./inboxColumnFilters";
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
  columnFilters,
  priority,
}: {
  tab: InboxTab;
  organizationId: string;
  filterText: string;
  columnFilters: Partial<Record<InboxFilterColumn, Set<string>>>;
  priority: InboxPriority;
}) {
  const listQuery = useQuery({
    queryKey: ["actionInbox", "list", tab, organizationId],
    queryFn: () =>
      listActionInboxItems({ state: tab, organizationId: organizationId || undefined }),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  const searchMatches = useMemo<InboxEntry[]>(
    () => (listQuery.data ?? []).filter((entry) => matchesInboxFilter(entry, filterText)),
    [listQuery.data, filterText],
  );
  /** Values each column filter offers: those present once the text filter has applied. */
  const columnUniqueValues = useMemo(
    () => columnFilterUniqueValues(searchMatches, INBOX_FILTERABLE_COLUMNS),
    [searchMatches],
  );
  const textMatches = useMemo(
    () => applyColumnFilters(searchMatches, columnFilters, INBOX_FILTERABLE_COLUMNS),
    [searchMatches, columnFilters],
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
    columnUniqueValues,
    isLoading: listQuery.isLoading,
    error: listQuery.isError ? listQuery.error : null,
    refetch: () => void listQuery.refetch(),
  };
}
