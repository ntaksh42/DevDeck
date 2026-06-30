import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  followWorkItem,
  listFollowedWorkItems,
  unfollowWorkItem,
  type WorkItemPreview,
} from '@/lib/azdoCommands';
import { useActiveOrganizationId } from '@/lib/useActiveConnection';
import { workItemQueryKeys } from './queryKeys';

/**
 * Tracks the local follow ("watch") state for the currently previewed work
 * item and exposes a toggle. Follow state lives in the SQLite-backed
 * watchlist (see `follow_work_item` / issue #304), not on the work item
 * itself, so it is fetched as a separate query and matched by id.
 */
export function useWorkItemFollow(preview: WorkItemPreview | null) {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();

  const followsQuery = useQuery({
    queryKey: workItemQueryKeys.follows(organizationId),
    queryFn: () => listFollowedWorkItems({ organizationId }),
    enabled: !!organizationId,
    staleTime: 60_000,
  });

  const isFollowed = useMemo(
    () => !!preview && (followsQuery.data ?? []).some((item) => item.id === preview.id),
    [followsQuery.data, preview],
  );

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.follows(organizationId) });
  }

  const followMutation = useMutation({
    mutationFn: async () => {
      if (!preview) return;
      await followWorkItem({
        organizationId: preview.organizationId,
        projectId: preview.projectId,
        projectName: preview.projectName,
        workItemId: preview.id,
        title: preview.title,
        workItemType: preview.workItemType,
        state: preview.state,
        assignedTo: preview.assignedTo,
        webUrl: preview.webUrl,
      });
    },
    onSuccess: invalidate,
  });

  const unfollowMutation = useMutation({
    mutationFn: async () => {
      if (!preview) return;
      await unfollowWorkItem({ organizationId: preview.organizationId, workItemId: preview.id });
    },
    onSuccess: invalidate,
  });

  function toggleFollow() {
    if (!preview) return;
    if (isFollowed) {
      void unfollowMutation.mutateAsync();
    } else {
      void followMutation.mutateAsync();
    }
  }

  return {
    isFollowed,
    toggleFollow,
    pending: followMutation.isPending || unfollowMutation.isPending,
  };
}
