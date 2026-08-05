import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  countWorkItemQueryHistory,
  searchCommits,
  type CommitSummary,
  type WorkItemQueryCountPoint,
} from "@/lib/azdoCommands";
import {
  analyzeBuckets,
  analyzeSampleTimestamps,
  bucketRangeEnd,
  bucketRangeStart,
  type AnalyzeBucket,
} from "./analyzeDateRange";
import type { AnalyzeGroup } from "./analyzeGroupsStorage";

/**
 * Past points never change, so they are cached indefinitely and only the bucket
 * still in progress is refetched. That keeps a revisit to a 30-day window down
 * to a single sample instead of thirty.
 */
const CLOSED_POINT_STALE_TIME = Infinity;
const OPEN_POINT_STALE_TIME = 5 * 60_000;

export type QuerySeries = {
  memberId: string;
  name: string;
  points: WorkItemQueryCountPoint[];
  isFetching: boolean;
  isError: boolean;
  error: unknown;
};

export type BranchSeries = {
  memberId: string;
  name: string;
  repositoryName: string;
  branch: string;
  commits: CommitSummary[];
  total: number;
  truncated: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
};

export function useAnalyzeBuckets(group: AnalyzeGroup | null): AnalyzeBucket[] {
  return useMemo(() => {
    if (!group) return [];
    return analyzeBuckets(group.granularity, group.rangeCount);
  }, [group?.granularity, group?.rangeCount, group?.id]);
}

/**
 * Samples every query in the group across the window. The whole series is one
 * request because the backend already limits how many points it runs at once.
 */
export function useQuerySeries(
  group: AnalyzeGroup | null,
  buckets: AnalyzeBucket[],
  enabled: boolean,
): QuerySeries[] {
  const timestamps = useMemo(() => analyzeSampleTimestamps(buckets), [buckets]);
  const queries = group?.queries ?? [];

  const results = useQueries({
    queries: queries.map((member) => {
      const projectId = member.projectId || group?.projectId || "";
      return {
        queryKey: [
          "analyzeQueryHistory",
          group?.organizationId ?? "",
          projectId,
          member.id,
          member.wiql,
          timestamps,
        ] as const,
        queryFn: () =>
          countWorkItemQueryHistory({
            organizationId: group?.organizationId,
            projectId,
            wiql: member.wiql,
            timestamps,
          }),
        enabled: enabled && !!projectId && timestamps.length > 0 && !!member.wiql.trim(),
        // The window's trailing point is the only one that can still move.
        staleTime: OPEN_POINT_STALE_TIME,
        gcTime: CLOSED_POINT_STALE_TIME === Infinity ? 30 * 60_000 : undefined,
      };
    }),
  });

  return queries.map((member, index) => ({
    memberId: member.id,
    name: member.name,
    points: results[index]?.data ?? [],
    isFetching: results[index]?.isFetching ?? false,
    isError: results[index]?.isError ?? false,
    error: results[index]?.error,
  }));
}

/** Fetches the commits for each branch in the group over the same window. */
export function useBranchSeries(
  group: AnalyzeGroup | null,
  buckets: AnalyzeBucket[],
  enabled: boolean,
): BranchSeries[] {
  const fromDate = bucketRangeStart(buckets);
  const toDate = bucketRangeEnd(buckets);
  const branches = group?.branches ?? [];

  const results = useQueries({
    queries: branches.map((member) => {
      const projectId = member.projectId || group?.projectId || "";
      return {
        queryKey: [
          "analyzeBranchCommits",
          group?.organizationId ?? "",
          projectId,
          member.repositoryId,
          member.branch,
          fromDate,
          toDate,
        ] as const,
        queryFn: () =>
          searchCommits({
            organizationId: group?.organizationId,
            branch: member.branch,
            projectIds: projectId ? [projectId] : undefined,
            repositoryIds: [member.repositoryId],
            fromDate,
            toDate,
          }),
        enabled: enabled && !!member.repositoryId && !!fromDate && !!toDate,
        staleTime: OPEN_POINT_STALE_TIME,
      };
    }),
  });

  return branches.map((member, index) => ({
    memberId: member.id,
    name: member.name,
    repositoryName: member.repositoryName,
    branch: member.branch,
    commits: results[index]?.data?.commits ?? [],
    total: results[index]?.data?.total ?? 0,
    truncated: results[index]?.data?.truncated ?? false,
    isFetching: results[index]?.isFetching ?? false,
    isError: results[index]?.isError ?? false,
    error: results[index]?.error,
  }));
}
