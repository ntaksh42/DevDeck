import type { QueryClient } from '@tanstack/react-query';

type WorkItemQueryViewKeyInput = {
  organizationId?: string;
  viewId?: string | null;
  projectId?: string | null;
  wiql?: string | null;
  limit?: number | null;
};

export const workItemQueryKeys = {
  myItems: (organizationId?: string) => ['myWorkItems', organizationId] as const,
  myItemsRoot: () => ['myWorkItems'] as const,
  projects: (organizationId?: string) => ['wiViewProjects', organizationId] as const,
  searchProjects: (organizationId?: string) => ['wiRepositories', organizationId] as const,
  savedQuery: (
    organizationId?: string,
    projectId?: string | null,
    queryId?: string | null,
  ) => ['savedQuery', organizationId, projectId, queryId] as const,
  queryCount: ({
    organizationId,
    viewId,
    projectId,
    wiql,
    limit,
  }: WorkItemQueryViewKeyInput) =>
    ['workItemQueryCount', organizationId, viewId, projectId, wiql, limit] as const,
  queryCountRoot: (organizationId?: string) =>
    organizationId
      ? (['workItemQueryCount', organizationId] as const)
      : (['workItemQueryCount'] as const),
  queryView: ({
    organizationId,
    viewId,
    projectId,
    wiql,
    limit,
  }: WorkItemQueryViewKeyInput) =>
    ['workItemQueryView', organizationId, viewId, projectId, wiql, limit] as const,
  queryViewRoot: (organizationId?: string) =>
    organizationId
      ? (['workItemQueryView', organizationId] as const)
      : (['workItemQueryView'] as const),
  preview: (
    organizationId?: string,
    projectId?: string,
    workItemId?: number,
    customFieldsSignature?: string,
  ) =>
    ['workItemPreview', organizationId, projectId, workItemId, customFieldsSignature] as const,
  previewRoot: () => ['workItemPreview'] as const,
  typeStates: (
    organizationId?: string,
    projectId?: string,
    workItemType?: string | null,
  ) => ['workItemTypeStates', organizationId, projectId, workItemType] as const,
  fields: (organizationId?: string, projectId?: string | null) =>
    ['workItemFields', organizationId, projectId] as const,
  mentions: (
    organizationId?: string,
    projectId?: string,
    workItemId?: number,
    query?: string,
  ) => ['workItemMentions', organizationId, projectId, workItemId, query] as const,
  assignees: (
    organizationId?: string,
    projectId?: string,
    workItemId?: number,
    query?: string,
  ) => ['workItemAssignees', organizationId, projectId, workItemId, query] as const,
  assigneesRoot: () => ['workItemAssignees'] as const,
};

export function invalidateWorkItemQueryViews(
  queryClient: QueryClient,
  organizationId?: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: workItemQueryKeys.queryViewRoot(organizationId),
  });
  void queryClient.invalidateQueries({
    queryKey: workItemQueryKeys.queryCountRoot(organizationId),
  });
}

export function invalidateWorkItemMutationCaches(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.myItemsRoot() });
  invalidateWorkItemQueryViews(queryClient);
  void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.previewRoot() });
  void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.assigneesRoot() });
}
