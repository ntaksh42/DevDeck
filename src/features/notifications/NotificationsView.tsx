import { useEffect, useMemo, useRef, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  commandErrorMessage,
  listNotifications,
  listOrganizations,
  markAllNotificationsRead,
  markNotificationsRead,
  type NotificationRecord,
} from "@/lib/azdoCommands";
import { navigateToWorkItem } from "@/lib/crossLinks";
import { openExternalUrl } from "@/lib/openExternal";
import { clamp } from "@/lib/utils";
import { useGridVirtualizer } from "@/lib/useGridVirtualizer";
import { HeaderToolbarPortal } from "@/components/HeaderToolbarSlot";
import { ErrorState, LoadingState } from "@/components/StateDisplay";
import { NotificationRow, NOTIFICATION_ROW_HEIGHT } from "./NotificationRow";
import {
  NOTIFICATION_CATEGORIES,
  notificationCategory,
  notificationKindsIn,
  type NotificationCategory,
} from "./notificationKinds";
import { notificationWebUrl, resolveNotificationAgentSubject, resolveNotificationJump } from "./notificationJump";
import { usePublishAgentSubject } from "@/components/agent/agentSubject";
import { ListStatusBar, itemCount } from "@/components/ListStatusBar";

const PAGE_SIZE = 100;
const OVERSCAN = 8;

type ListEntry =
  | { type: "header"; label: string; count: number }
  | { type: "row"; record: NotificationRecord; index: number };

// Splits the (newest-first) records into TODAY / EARLIER sections. Headers are
// flat entries so the grid's fixed-height windowing still applies; selection
// and keyboard navigation work on record indices, which skips the headers.
function buildEntries(records: NotificationRecord[]): { entries: ListEntry[]; entryIndexOf: number[] } {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayCount = records.filter(
    (record) => new Date(record.createdAt).getTime() >= startOfToday.getTime(),
  ).length;
  const entries: ListEntry[] = [];
  const entryIndexOf: number[] = [];
  records.forEach((record, index) => {
    if (index === 0 && todayCount > 0) entries.push({ type: "header", label: "Today", count: todayCount });
    if (index === todayCount) {
      entries.push({ type: "header", label: "Earlier", count: records.length - todayCount });
    }
    entryIndexOf[index] = entries.length;
    entries.push({ type: "row", record, index });
  });
  return { entries, entryIndexOf };
}

export function NotificationsView({
  onOpenPullRequest,
  onOpenView,
}: {
  onOpenPullRequest: (query: string, organizationId?: string) => void;
  onOpenView: (view: "pipelines" | "settings") => void;
}) {
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [category, setCategory] = useState<NotificationCategory | "all">("all");
  const [organizationId, setOrganizationId] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const restoreFocusRef = useRef(false);

  const organizationsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: listOrganizations,
    staleTime: 5 * 60_000,
  });
  const organizations = organizationsQuery.data ?? [];
  const organizationNameById = useMemo(
    () => new Map(organizations.map((org) => [org.id, org.name])),
    [organizations],
  );

  const fetchPage = (kinds: string[] | undefined) => (pageParam: number | undefined) =>
    listNotifications({
      limit: PAGE_SIZE,
      beforeId: pageParam,
      unreadOnly: unreadOnly || undefined,
      organizationId: organizationId || undefined,
      kinds,
    });
  const pageOptions = {
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage: Awaited<ReturnType<typeof listNotifications>>) =>
      lastPage.hasMore ? lastPage.items[lastPage.items.length - 1]?.id : undefined,
    staleTime: 30_000,
    // Keeps the previous page's rows on screen while a filter change refetches,
    // instead of flashing the grid to "No notifications" mid-request.
    placeholderData: keepPreviousData,
  };
  // The unfiltered list feeds the category counts; with "All" selected it is also the list shown.
  const allQuery = useInfiniteQuery({
    queryKey: ["notifications", "list", organizationId, unreadOnly, "all"],
    queryFn: ({ pageParam }) => fetchPage(undefined)(pageParam),
    ...pageOptions,
  });
  // A category is filtered by the backend so "Load more" pages stay within it.
  const categoryQuery = useInfiniteQuery({
    queryKey: ["notifications", "list", organizationId, unreadOnly, category],
    queryFn: ({ pageParam }) =>
      fetchPage(category === "all" ? undefined : notificationKindsIn(category))(pageParam),
    ...pageOptions,
    enabled: category !== "all",
  });
  const listQuery = category === "all" ? allQuery : categoryQuery;

  const allItems = useMemo(
    () => allQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [allQuery.data],
  );
  // Counts reflect the loaded rows of the unfiltered list (after the Unread / organization filters).
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allItems.length, pr: 0, workItem: 0, pipeline: 0, sync: 0 };
    for (const record of allItems) counts[notificationCategory(record.kind)] += 1;
    return counts;
  }, [allItems]);
  const items = useMemo(
    () => listQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [listQuery.data],
  );
  const { entries, entryIndexOf } = useMemo(() => buildEntries(items), [items]);

  const markReadMutation = useMutation({
    mutationFn: (ids: number[]) => markNotificationsRead({ ids }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
  const markAllReadMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const {
    scrollerRef,
    firstRow: firstVirtualRow,
    lastRow: lastVirtualRow,
    topPadding: virtualTopPadding,
    bottomPadding: virtualBottomPadding,
    scrollRowIntoView,
  } = useGridVirtualizer({
    rowCount: entries.length,
    rowHeight: NOTIFICATION_ROW_HEIGHT,
    overscan: OVERSCAN,
  });
  const virtualEntries = entries.slice(firstVirtualRow, lastVirtualRow);

  // The Agent panel (the drawer; this view has no dock) follows the selected notification's PR / work item.
  const selectedRecord = items[selectedIndex];
  usePublishAgentSubject(selectedRecord ? resolveNotificationAgentSubject(selectedRecord) : null);

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(items.length - 1, 0)));
  }, [items.length]);

  // Rows outside the virtual window unmount, so roving focus is restored once
  // the row for the new selection is mounted again. This effect runs on every
  // render (the row may mount on any of them), so it must not steal focus that
  // the user has since moved elsewhere — e.g. to the organization select while
  // a background notification refresh re-renders the view.
  useEffect(() => {
    if (!restoreFocusRef.current) return;
    const row = rowRefs.current[selectedIndex];
    if (!row) return;
    const active = document.activeElement;
    const focusMovedOffGrid =
      active instanceof HTMLElement &&
      active !== document.body &&
      !active.closest('[role="grid"], [role="row"]');
    if (focusMovedOffGrid) {
      restoreFocusRef.current = false;
      return;
    }
    restoreFocusRef.current = false;
    row.focus({ preventScroll: true });
  });

  function moveSelectionTo(index: number) {
    const next = clamp(index, 0, items.length - 1);
    restoreFocusRef.current = true;
    scrollRowIntoView(entryIndexOf[next] ?? next);
    setSelectedIndex(next);
  }

  function moveSelection(delta: number) {
    moveSelectionTo(selectedIndex + delta);
  }

  function markReadIfUnread(record: NotificationRecord) {
    if (!record.isRead) markReadMutation.mutate([record.id]);
  }

  function jumpTo(record: NotificationRecord) {
    const target = resolveNotificationJump(record);
    switch (target.type) {
      case "pullRequest":
        onOpenPullRequest(String(target.pullRequestId), target.organizationId);
        break;
      case "workItem":
        navigateToWorkItem({ workItemId: target.workItemId, organizationId: target.organizationId });
        break;
      case "view":
        onOpenView(target.view);
        break;
      case "external":
        void openExternalUrl(target.url);
        break;
      case "none":
        break;
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.target instanceof Element && event.target.closest("button, input, select, textarea, a")) return;
    if (event.ctrlKey || event.metaKey) {
      if (event.key === "Enter") {
        event.preventDefault();
        const record = items[selectedIndex];
        if (!record) return;
        markReadIfUnread(record);
        const url = notificationWebUrl(record);
        if (url) void openExternalUrl(url);
      }
      return;
    }
    if (items.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "j" || event.key === "J") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp" || event.key === "k" || event.key === "K") {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveSelectionTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveSelectionTo(items.length - 1);
    } else if (event.key === "PageDown") {
      event.preventDefault();
      moveSelection(10);
    } else if (event.key === "PageUp") {
      event.preventDefault();
      moveSelection(-10);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const record = items[selectedIndex];
      if (!record) return;
      markReadIfUnread(record);
      jumpTo(record);
    } else if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      const record = items[selectedIndex];
      if (record) markReadIfUnread(record);
    }
  }

  const categoryButtons = [{ value: "all" as const, label: "All" }, ...NOTIFICATION_CATEGORIES];
  const categoryButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function focusList() {
    const row = rowRefs.current[selectedIndex];
    if (row) row.focus({ preventScroll: true });
    else (document.querySelector('[data-grid-focus-fallback="true"]') as HTMLElement | null)?.focus();
  }

  function handleCategoryKeyDown(event: React.KeyboardEvent, position: number) {
    const last = categoryButtons.length - 1;
    let target: number | null = null;
    if (event.key === "ArrowRight") target = position === last ? 0 : position + 1;
    else if (event.key === "ArrowLeft") target = position === 0 ? last : position - 1;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = last;
    else if (event.key === "ArrowDown" || event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      focusList();
      return;
    }
    if (target === null) return;
    event.preventDefault();
    event.stopPropagation();
    categoryButtonRefs.current[target]?.focus();
  }

  const showOrgFilter = organizations.length > 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <HeaderToolbarPortal>
        <div role="group" aria-label="Notification toolbar" className="flex shrink-0 items-center gap-2">
          <div role="group" aria-label="Filter by notification category" className="flex items-center gap-1">
            {categoryButtons.map((button, position) => {
              const count = categoryCounts[button.value] ?? 0;
              const active = category === button.value;
              return (
                <button
                  key={button.value}
                  ref={(el) => {
                    categoryButtonRefs.current[position] = el;
                  }}
                  type="button"
                  aria-pressed={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => {
                    setCategory(button.value);
                    setSelectedIndex(0);
                  }}
                  onKeyDown={(event) => handleCategoryKeyDown(event, position)}
                  className={`inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-xs font-medium outline-none focus:ring-2 focus:ring-ring ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : `border-border bg-card hover:bg-secondary ${count === 0 ? "text-muted-foreground/50" : ""}`
                  }`}
                >
                  {button.label}
                  <span className="tabular-nums">{count}</span>
                </button>
              );
            })}
          </div>

          <label className="flex items-center gap-1.5 whitespace-nowrap text-sm">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(event) => setUnreadOnly(event.target.checked)}
              className="h-4 w-4"
            />
            Unread only
          </label>

        {showOrgFilter ? (
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Organization</span>
            <select
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
              aria-label="Filter by organization"
              className="h-7 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All organizations</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <button
          type="button"
          onClick={() => markAllReadMutation.mutate()}
          disabled={markAllReadMutation.isPending}
          className="inline-flex h-7 items-center rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
        >
          Mark all read
        </button>
        </div>
      </HeaderToolbarPortal>

      {listQuery.isError ? (
        <ErrorState
          message={commandErrorMessage(listQuery.error)}
          onRetry={() => void listQuery.refetch()}
        />
      ) : null}

      <div data-grid-focus-fallback="true" tabIndex={-1} className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card">
        {listQuery.isLoading ? (
          <LoadingState />
        ) : items.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            No notifications.
          </div>
        ) : (
          <div
            role="grid"
            aria-label="Notifications"
            data-primary-grid="true"
            tabIndex={-1}
            className="flex min-h-0 flex-1 flex-col outline-none"
            onKeyDown={handleKeyDown}
          >
            <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto">
              {virtualTopPadding > 0 ? <div style={{ height: virtualTopPadding }} /> : null}
              {virtualEntries.map((entry) => {
                if (entry.type === "header") {
                  return (
                    <div
                      key={`header-${entry.label}`}
                      data-testid="notification-section-header"
                      // Fixed row height (virtualizer); the band sits at the bottom so the gap reads as section spacing.
                      className="flex h-[44px] items-end"
                    >
                      <div className="w-full border-b border-border bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {entry.label} · {entry.count}
                      </div>
                    </div>
                  );
                }
                const { record, index } = entry;
                return (
                  <NotificationRow
                    key={record.id}
                    ref={(el) => {
                      rowRefs.current[index] = el;
                    }}
                    record={record}
                    selected={index === selectedIndex}
                    organizationLabel={
                      showOrgFilter && record.organizationId
                        ? organizationNameById.get(record.organizationId)
                        : null
                    }
                    onSelect={() => setSelectedIndex(index)}
                  />
                );
              })}
              {virtualBottomPadding > 0 ? <div style={{ height: virtualBottomPadding }} /> : null}
            </div>
            {listQuery.hasNextPage ? (
              <div className="flex shrink-0 justify-center border-t border-border py-2">
                <button
                  type="button"
                  onClick={() => void listQuery.fetchNextPage()}
                  disabled={listQuery.isFetchingNextPage}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {listQuery.isFetchingNextPage ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : null}
                  Load more
                </button>
              </div>
            ) : null}
          </div>
        )}
        <ListStatusBar
          summary={[itemCount(items.length), `${items.filter((record) => !record.isRead).length} unread`]}
        />
      </div>
    </div>
  );
}
