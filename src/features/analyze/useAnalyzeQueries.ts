import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  countWorkItemQueryHistory,
  searchCommits,
  type CommitSummary,
  type WorkItemQueryCountPoint,
} from "@/lib/azdoCommands";
import {
  analyzeSampleTimestamps,
  bucketRangeEnd,
  bucketRangeStart,
  type AnalyzeBucket,
} from "./analyzeDateRange";
import { resolveAnalyzeBuckets } from "./analyzeRange";
import type { AnalyzeMilestone } from "./analyzeMilestones";
import type { AnalyzeGroup } from "./analyzeGroupsStorage";

/**
 * A closed bucket's count cannot change once the instant has passed, so those
 * samples are cached for the session and only the bucket still in progress is
 * refetched. The series is split into two requests to make that possible: one
 * for the settled points, one for the trailing point.
 */
const CLOSED_POINT_STALE_TIME = Infinity;
const CLOSED_POINT_GC_TIME = 60 * 60_000;
const OPEN_POINT_STALE_TIME = 5 * 60_000;

export type QuerySeries = {
  memberId: string;
  name: string;
  milestones: AnalyzeMilestone[];
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
    return resolveAnalyzeBuckets(group);
  }, [
    group?.granularity,
    group?.rangeCount,
    group?.rangePreset,
    group?.rangeFrom,
    group?.rangeTo,
    group?.id,
  ]);
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
  // The trailing bucket is the only one still in progress; everything before it
  // is settled and can be cached for the session.
  const settled = useMemo(() => timestamps.slice(0, -1), [timestamps]);
  const open = useMemo(() => timestamps.slice(-1), [timestamps]);
  const queries = group?.queries ?? [];

  const settledResults = useQueries({
    queries: queries.map((member) => {
      const projectId = member.projectId || group?.projectId || "";
      return {
        queryKey: [
          "analyzeQueryHistory",
          "settled",
          group?.organizationId ?? "",
          projectId,
          member.id,
          member.wiql,
          settled,
        ] as const,
        queryFn: () =>
          countWorkItemQueryHistory({
            organizationId: group?.organizationId,
            projectId,
            wiql: member.wiql,
            timestamps: settled,
          }),
        enabled: enabled && !!projectId && settled.length > 0 && !!member.wiql.trim(),
        staleTime: CLOSED_POINT_STALE_TIME,
        gcTime: CLOSED_POINT_GC_TIME,
      };
    }),
  });

  const openResults = useQueries({
    queries: queries.map((member) => {
      const projectId = member.projectId || group?.projectId || "";
      return {
        queryKey: [
          "analyzeQueryHistory",
          "open",
          group?.organizationId ?? "",
          projectId,
          member.id,
          member.wiql,
          open,
        ] as const,
        queryFn: () =>
          countWorkItemQueryHistory({
            organizationId: group?.organizationId,
            projectId,
            wiql: member.wiql,
            timestamps: open,
          }),
        enabled: enabled && !!projectId && open.length > 0 && !!member.wiql.trim(),
        staleTime: OPEN_POINT_STALE_TIME,
      };
    }),
  });

  return queries.map((member, index) => {
    const settledResult = settledResults[index];
    const openResult = openResults[index];
    const settledPoints = settledResult?.data;
    const openPoints = openResult?.data;
    // The two halves only line up with the buckets once both have arrived.
    // Emitting the trailing point on its own would slide it to index 0 and
    // draw the newest count at the far left of the window.
    const points =
      settledPoints && openPoints
        ? [...settledPoints, ...openPoints]
        : settled.length === 0
          ? (openPoints ?? [])
          : (settledPoints ?? []);
    return {
      memberId: member.id,
      name: member.name,
      milestones: member.milestones,
      points,
      isFetching: (settledResult?.isFetching ?? false) || (openResult?.isFetching ?? false),
      isError: (settledResult?.isError ?? false) || (openResult?.isError ?? false),
      error: settledResult?.error ?? openResult?.error,
    };
  });
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
