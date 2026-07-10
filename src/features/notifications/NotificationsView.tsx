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
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { ErrorState, LoadingState } from "@/components/StateDisplay";
import { NotificationRow, NOTIFICATION_ROW_HEIGHT } from "./NotificationRow";
import { NOTIFICATION_KIND_OPTIONS } from "./notificationKinds";
import { notificationWebUrl, resolveNotificationJump } from "./notificationJump";

const PAGE_SIZE = 100;
const OVERSCAN = 8;

export function NotificationsView({
  onOpenPullRequest,
  onOpenView,
}: {
  onOpenPullRequest: (query: string, organizationId?: string) => void;
  onOpenView: (view: "pipelines" | "settings") => void;
}) {
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [kinds, setKinds] = useState<string[]>([]);
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

  const listQuery = useInfiniteQuery({
    queryKey: ["notifications", "list", organizationId, unreadOnly, kinds],
    queryFn: ({ pageParam }: { pageParam: number | undefined }) =>
      listNotifications({
        limit: PAGE_SIZE,
        beforeId: pageParam,
        unreadOnly: unreadOnly || undefined,
        kinds: kinds.length > 0 ? kinds : undefined,
        organizationId: organizationId || undefined,
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.items[lastPage.items.length - 1]?.id : undefined,
    staleTime: 30_000,
    // Keeps the previous page's rows on screen while a filter change refetches,
    // instead of flashing the grid to "No notifications" mid-request.
    placeholderData: keepPreviousData,
  });

  const items = useMemo(
    () => listQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [listQuery.data],
  );

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
    rowCount: items.length,
    rowHeight: NOTIFICATION_ROW_HEIGHT,
    overscan: OVERSCAN,
  });
  const virtualRows = items.slice(firstVirtualRow, lastVirtualRow);

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(items.length - 1, 0)));
  }, [items.length]);

  // Rows outside the virtual window unmount, so roving focus is restored once
  // the row for the new selection is mounted again.
  useEffect(() => {
    if (!restoreFocusRef.current) return;
    const row = rowRefs.current[selectedIndex];
    if (!row) return;
    restoreFocusRef.current = false;
    row.focus({ preventScroll: true });
  });

  function moveSelectionTo(index: number) {
    const next = clamp(index, 0, items.length - 1);
    restoreFocusRef.current = true;
    scrollRowIntoView(next);
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

  const kindFilterOptions = NOTIFICATION_KIND_OPTIONS;
  const showOrgFilter = organizations.length > 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => setUnreadOnly(event.target.checked)}
            className="h-4 w-4"
          />
          Unread only
        </label>

        <div className="min-w-[220px]">
          <MultiSelectFilter
            options={kindFilterOptions}
            selected={kinds}
            onChange={setKinds}
            placeholder="All kinds"
            ariaLabel="Filter by notification kind"
            className="h-8"
          />
        </div>

        {showOrgFilter ? (
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Organization</span>
            <select
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
              aria-label="Filter by organization"
              className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
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
          className="ml-auto rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
        >
          Mark all read
        </button>
      </div>

      {listQuery.isError ? (
        <ErrorState
          message={commandErrorMessage(listQuery.error)}
          onRetry={() => void listQuery.refetch()}
        />
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card">
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
              {virtualRows.map((record, offset) => {
                const index = firstVirtualRow + offset;
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
      </div>
    </div>
  );
}
