import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import {
  setWorkItemsState,
  assignWorkItems,
  setWorkItemsPriority,
  setWorkItemsTags,
  listWorkItemTypeStates,
  recordAssigneeInteraction,
  searchWorkItemAssignees,
  commandErrorMessage,
  type BulkWorkItemResult,
  type WorkItemAssigneeCandidate,
  type WorkItemSummary,
} from '@/lib/azdoCommands';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { invalidateWorkItemMutationCaches, workItemQueryKeys } from './queryKeys';
import { workItemSummaryKey, setPriorityExtraField } from './workItemsGridHelpers';
import { summarizeBy } from './BulkActionBar';

const COMMON_STATES = ["New", "Active", "Resolved", "Closed", "To Do", "Doing", "Done"];

export function useBulkActions({
  checkedItems,
  queryClient,
  setItemOverrides,
  setCheckedIds,
  setLastCheckedIndex,
}: {
  checkedItems: WorkItemSummary[];
  queryClient: QueryClient;
  setItemOverrides: React.Dispatch<React.SetStateAction<Map<string, Partial<WorkItemSummary>>>>;
  setCheckedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setLastCheckedIndex: React.Dispatch<React.SetStateAction<number | null>>;
}) {
  const [bulkStateOpen, setBulkStateOpen] = useState(false);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkPriorityOpen, setBulkPriorityOpen] = useState(false);
  const [bulkAssignQuery, setBulkAssignQuery] = useState("");
  const [bulkToast, setBulkToast] = useState<string | null>(null);
  const [bulkFailures, setBulkFailures] = useState<BulkWorkItemResult[]>([]);

  const bulkStateType = (() => {
    const types = new Set(checkedItems.map((item) => item.workItemType).filter(Boolean));
    return types.size === 1 ? ([...types][0] ?? null) : null;
  })();
  const typeBreakdown = summarizeBy(checkedItems.map((item) => item.workItemType));
  const stateBreakdown = summarizeBy(checkedItems.map((item) => item.state));
  const firstCheckedItem = checkedItems[0] ?? null;

  const bulkStatesQuery = useQuery({
    queryKey: workItemQueryKeys.typeStates(
      firstCheckedItem?.organizationId,
      firstCheckedItem?.projectId,
      bulkStateType,
    ),
    queryFn: () =>
      listWorkItemTypeStates({
        organizationId: firstCheckedItem?.organizationId,
        projectId: firstCheckedItem?.projectId ?? "",
        workItemType: bulkStateType ?? "",
      }),
    enabled: bulkStateOpen && !!bulkStateType && !!firstCheckedItem,
    staleTime: Infinity,
  });
  const bulkStateOptions = bulkStateType && bulkStatesQuery.data ? bulkStatesQuery.data : COMMON_STATES;

  const debouncedBulkAssignQuery = useDebouncedValue(bulkAssignQuery, 200);
  const bulkAssigneesQuery = useQuery({
    queryKey: workItemQueryKeys.assignees(
      firstCheckedItem?.organizationId,
      firstCheckedItem?.projectId,
      firstCheckedItem?.id,
      debouncedBulkAssignQuery,
    ),
    queryFn: () =>
      searchWorkItemAssignees({
        organizationId: firstCheckedItem!.organizationId,
        projectId: firstCheckedItem!.projectId,
        workItemId: firstCheckedItem!.id,
        query: debouncedBulkAssignQuery,
      }),
    enabled:
      bulkAssignOpen && !!firstCheckedItem && debouncedBulkAssignQuery.trim().length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const bulkDefaultAssigneesQuery = useQuery({
    queryKey: workItemQueryKeys.assignees(
      firstCheckedItem?.organizationId,
      firstCheckedItem?.projectId,
      firstCheckedItem?.id,
      "",
    ),
    queryFn: () =>
      searchWorkItemAssignees({
        organizationId: firstCheckedItem!.organizationId,
        projectId: firstCheckedItem!.projectId,
        workItemId: firstCheckedItem!.id,
        query: "",
      }),
    enabled: bulkAssignOpen && !!firstCheckedItem,
    staleTime: 60_000,
  });
  const bulkAssignOptions = bulkAssignQuery.trim()
    ? (bulkAssigneesQuery.data ?? [])
    : (bulkDefaultAssigneesQuery.data ?? []);
  const bulkAssignLoading = bulkAssignQuery.trim()
    ? bulkAssigneesQuery.isLoading
    : bulkDefaultAssigneesQuery.isLoading;

  function showBulkToast(results: BulkWorkItemResult[]) {
    const failed = results.filter((r) => r.error).length;
    const succeeded = results.length - failed;
    setBulkFailures(results.filter((r) => r.error));
    const msg =
      failed === 0
        ? `${succeeded} item${succeeded === 1 ? "" : "s"} updated`
        : `${succeeded} updated, ${failed} failed`;
    setBulkToast(msg);
    window.setTimeout(() => setBulkToast(null), 3000);
  }

  const bulkStateMutation = useMutation({
    mutationFn: async (state: string) => {
      const groups = new Map<string, typeof checkedItems>();
      for (const item of checkedItems) {
        const key = `${item.organizationId}:${item.projectId}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }
      const allResults: BulkWorkItemResult[] = [];
      // BulkWorkItemResult carries only the work item id, which collides across
      // organizations/projects. Track succeeded items by their fully-qualified
      // summary key so optimistic overrides land on the right rows.
      const succeededKeys = new Set<string>();
      for (const [, items] of groups) {
        const r = await setWorkItemsState({
          organizationId: items[0].organizationId,
          projectId: items[0].projectId,
          workItemIds: items.map((i) => i.id),
          state,
        });
        allResults.push(...r);
        const failedIds = new Set(r.filter((result) => result.error).map((result) => result.id));
        for (const item of items) {
          if (failedIds.has(item.id)) continue;
          succeededKeys.add(workItemSummaryKey(item));
        }
      }
      return { results: allResults, succeededKeys };
    },
    onSuccess: ({ results, succeededKeys }, state) => {
      if (succeededKeys.size > 0) {
        setItemOverrides((current) => {
          const next = new Map(current);
          for (const item of checkedItems) {
            const key = workItemSummaryKey(item);
            if (!succeededKeys.has(key)) continue;
            next.set(key, {
              ...(next.get(key) ?? {}),
              state,
            });
          }
          return next;
        });
      }
      setBulkStateOpen(false);
      setCheckedIds(new Set());
      setLastCheckedIndex(null);
      showBulkToast(results);
      invalidateWorkItemMutationCaches(queryClient);
    },
    onError: (e) => {
      setBulkToast(commandErrorMessage(e));
      window.setTimeout(() => setBulkToast(null), 3000);
    },
  });

  const bulkAssignMutation = useMutation({
    mutationFn: async (candidate: WorkItemAssigneeCandidate) => {
      const groups = new Map<string, typeof checkedItems>();
      for (const item of checkedItems) {
        const key = `${item.organizationId}:${item.projectId}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }
      const allResults: BulkWorkItemResult[] = [];
      // BulkWorkItemResult carries only the work item id, which collides across
      // organizations/projects. Track succeeded items by their fully-qualified
      // summary key so optimistic overrides and history land on the right items.
      const succeededKeys = new Set<string>();
      const succeededOrgIds = new Set<string>();
      for (const [, items] of groups) {
        const r = await assignWorkItems({
          organizationId: items[0].organizationId,
          projectId: items[0].projectId,
          workItemIds: items.map((i) => i.id),
          assignedTo: candidate.assignValue,
        });
        allResults.push(...r);
        const failedIds = new Set(r.filter((result) => result.error).map((result) => result.id));
        for (const item of items) {
          if (failedIds.has(item.id)) continue;
          succeededKeys.add(workItemSummaryKey(item));
          succeededOrgIds.add(item.organizationId);
        }
      }
      return { results: allResults, succeededKeys, succeededOrgIds };
    },
    onSuccess: ({ results, succeededKeys, succeededOrgIds }, candidate) => {
      if (succeededKeys.size > 0 && candidate.uniqueName) {
        for (const organizationId of succeededOrgIds) {
          void recordAssigneeInteraction({
            organizationId,
            userId: candidate.id,
            displayName: candidate.displayName,
            uniqueName: candidate.uniqueName,
          }).catch(() => {
            // History is best-effort; the assignment itself already succeeded.
          });
        }
      }
      if (succeededKeys.size > 0) {
        setItemOverrides((current) => {
          const next = new Map(current);
          for (const item of checkedItems) {
            const key = workItemSummaryKey(item);
            if (!succeededKeys.has(key)) continue;
            next.set(key, {
              ...(next.get(key) ?? {}),
              assignedTo: candidate.displayName,
            });
          }
          return next;
        });
      }
      setBulkAssignOpen(false);
      setBulkAssignQuery("");
      setCheckedIds(new Set());
      setLastCheckedIndex(null);
      showBulkToast(results);
      invalidateWorkItemMutationCaches(queryClient);
    },
    onError: (e) => {
      setBulkToast(commandErrorMessage(e));
      window.setTimeout(() => setBulkToast(null), 3000);
    },
  });

  const bulkPriorityMutation = useMutation({
    mutationFn: async (priority: number) => {
      const groups = new Map<string, typeof checkedItems>();
      for (const item of checkedItems) {
        const key = `${item.organizationId}:${item.projectId}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }
      const allResults: BulkWorkItemResult[] = [];
      // BulkWorkItemResult carries only the work item id, which collides across
      // organizations/projects. Track succeeded items by their fully-qualified
      // summary key so optimistic overrides land on the right rows.
      const succeededKeys = new Set<string>();
      for (const [, items] of groups) {
        const r = await setWorkItemsPriority({
          organizationId: items[0].organizationId,
          projectId: items[0].projectId,
          workItemIds: items.map((i) => i.id),
          priority,
        });
        allResults.push(...r);
        const failedIds = new Set(r.filter((result) => result.error).map((result) => result.id));
        for (const item of items) {
          if (failedIds.has(item.id)) continue;
          succeededKeys.add(workItemSummaryKey(item));
        }
      }
      return { results: allResults, succeededKeys };
    },
    onSuccess: ({ results, succeededKeys }, priority) => {
      if (succeededKeys.size > 0) {
        setItemOverrides((current) => {
          const next = new Map(current);
          for (const item of checkedItems) {
            const key = workItemSummaryKey(item);
            if (!succeededKeys.has(key)) continue;
            const override = next.get(key) ?? {};
            const baseFields = override.extraFields ?? item.extraFields;
            const extraFields = setPriorityExtraField(baseFields, priority);
            next.set(key, {
              ...override,
              extraFields,
            });
          }
          return next;
        });
      }
      setBulkPriorityOpen(false);
      setCheckedIds(new Set());
      setLastCheckedIndex(null);
      showBulkToast(results);
      invalidateWorkItemMutationCaches(queryClient);
    },
    onError: (e) => {
      setBulkToast(commandErrorMessage(e));
      window.setTimeout(() => setBulkToast(null), 3000);
    },
  });

  const bulkTagsMutation = useMutation({
    mutationFn: async (change: { tag: string; mode: "add" | "remove" }) => {
      const groups = new Map<string, typeof checkedItems>();
      for (const item of checkedItems) {
        const key = `${item.organizationId}:${item.projectId}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }
      const allResults: BulkWorkItemResult[] = [];
      for (const [, items] of groups) {
        const r = await setWorkItemsTags({
          organizationId: items[0].organizationId,
          projectId: items[0].projectId,
          workItemIds: items.map((i) => i.id),
          addTags: change.mode === "add" ? [change.tag] : [],
          removeTags: change.mode === "remove" ? [change.tag] : [],
        });
        allResults.push(...r);
      }
      return allResults;
    },
    onSuccess: (results) => {
      setCheckedIds(new Set());
      setLastCheckedIndex(null);
      showBulkToast(results);
      // Tag changes are a server-side merge; refetch rather than guessing the
      // new per-item tag set locally.
      invalidateWorkItemMutationCaches(queryClient);
    },
    onError: (e) => {
      setBulkToast(commandErrorMessage(e));
      window.setTimeout(() => setBulkToast(null), 3000);
    },
  });

  return {
    bulkStateOpen,
    setBulkStateOpen,
    bulkAssignOpen,
    setBulkAssignOpen,
    bulkPriorityOpen,
    setBulkPriorityOpen,
    bulkAssignQuery,
    setBulkAssignQuery,
    bulkToast,
    bulkFailures,
    setBulkFailures,
    bulkStateOptions,
    stateLoading: bulkStatesQuery.isFetching,
    bulkAssignOptions,
    bulkAssignLoading,
    bulkStateMutation,
    bulkAssignMutation,
    bulkPriorityMutation,
    bulkTagsMutation,
    typeBreakdown,
    stateBreakdown,
    firstCheckedItem,
  };
}
