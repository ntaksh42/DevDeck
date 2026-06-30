import type { QueryClient } from '@tanstack/react-query';

type WorkItemQueryViewKeyInput = {
  organizationId?: string;
  viewId?: string | null;
  projectId?: string | null;
  wiql?: string | null;
  limit?: number | null;
  extraFieldsSignature?: string;
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
    extraFieldsSignature,
  }: WorkItemQueryViewKeyInput) =>
    [
      'workItemQueryView',
      organizationId,
      viewId,
      projectId,
      wiql,
      limit,
      extraFieldsSignature ?? '',
    ] as const,
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
  updates: (
    organizationId?: string,
    projectId?: string,
    workItemId?: number,
  ) => ['workItemUpdates', organizationId, projectId, workItemId] as const,
  typeStates: (
    organizationId?: string,
    projectId?: string,
    workItemType?: string | null,
  ) => ['workItemTypeStates', organizationId, projectId, workItemType] as const,
  fieldAllowedValues: (
    organizationId?: string,
    projectId?: string,
    workItemType?: string | null,
    fieldReferenceName?: string | null,
  ) =>
    [
      'workItemFieldAllowedValues',
      organizationId,
      projectId,
      workItemType,
      fieldReferenceName,
    ] as const,
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
  follows: (organizationId?: string) => ['workItemFollows', organizationId] as const,
};

export function invalidateWorkItemQueryViews(
  queryClient: QueryClient,
  organizationId?: string,
  refetchType: "active" | "none" = "active",
): void {
  void queryClient.invalidateQueries({
    queryKey: workItemQueryKeys.queryViewRoot(organizationId),
    refetchType,
  });
  void queryClient.invalidateQueries({
    queryKey: workItemQueryKeys.queryCountRoot(organizationId),
    refetchType,
  });
}

export function invalidateWorkItemMutationCaches(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.myItemsRoot() });
  invalidateWorkItemQueryViews(queryClient);
  void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.previewRoot() });
  void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.assigneesRoot() });
}
