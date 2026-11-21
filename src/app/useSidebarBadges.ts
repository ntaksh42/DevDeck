import { useQuery } from "@tanstack/react-query";
import {
  getUnreadNotificationsCount,
  listMyReviewPullRequests,
  listMyWorkItems,
} from "@/lib/azdoCommands";

/** Count badges for My Reviews, My Work Items and Notifications in the sidebar. */
export function useSidebarBadges(badgeOrganizationId: string) {
  const myReviewsCountQuery = useQuery({
    queryKey: ["myReviews", badgeOrganizationId],
    queryFn: () => listMyReviewPullRequests({ organizationId: badgeOrganizationId }),
    enabled: !!badgeOrganizationId,
    staleTime: 5 * 60_000,
  });
  const myWorkItemsCountQuery = useQuery({
    queryKey: ["myWorkItems", badgeOrganizationId],
    queryFn: () => listMyWorkItems({ organizationId: badgeOrganizationId }),
    enabled: !!badgeOrganizationId,
    staleTime: 5 * 60_000,
  });
  // My Reviews badge counts PRs still awaiting my vote (the actionable inbox).
  const myReviewsBadge = myReviewsCountQuery.data
    ? myReviewsCountQuery.data.filter((pr) => pr.myVote === 0 && !pr.isDraft).length
    : null;
  const myWorkItemsBadge = myWorkItemsCountQuery.data?.length ?? null;

  // The notifications badge is cross-org, so it stays enabled independent of
  // the active connection (unlike the badges above).
  const notificationsUnreadQuery = useQuery({
    queryKey: ["notifications", "unreadCount"],
    queryFn: getUnreadNotificationsCount,
    staleTime: 30_000,
  });
  const notificationsBadge = notificationsUnreadQuery.data ?? null;

  return { myReviewsBadge, myWorkItemsBadge, notificationsBadge };
}
