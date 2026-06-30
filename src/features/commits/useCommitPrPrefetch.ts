import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { type CommitSummary, getCommitPullRequestsBatch } from "@/lib/azdoCommands";
import { commitPrQueryKey } from "./commitSearchUtils";

/**
 * Prefetches related-PR data for a visible window of commit rows in one
 * batched request per repository, then drops the results into the same
 * per-commit query cache `CommitGridRow`'s passive lookup and the preview
 * panel's active lookup both read from (`commitPrQueryKey`). This lets the
 * grid show PR counts up front instead of only after a row is previewed
 * (#532), without issuing one request per row.
 */
export function useCommitPrPrefetch(visibleCommits: CommitSummary[]): void {
  const queryClient = useQueryClient();
  const requestedRef = useRef(new Set<string>());

  useEffect(() => {
    const groups = new Map<
      string,
      { organizationId: string; repositoryId: string; commitIds: string[] }
    >();
    for (const commit of visibleCommits) {
      const groupKey = `${commit.organizationId}:${commit.repositoryId}`;
      const entryKey = `${groupKey}:${commit.commitId}`;
      if (requestedRef.current.has(entryKey)) continue;
      if (queryClient.getQueryData(commitPrQueryKey(commit)) !== undefined) continue;

      let group = groups.get(groupKey);
      if (!group) {
        group = {
          organizationId: commit.organizationId,
          repositoryId: commit.repositoryId,
          commitIds: [],
        };
        groups.set(groupKey, group);
      }
      group.commitIds.push(commit.commitId);
    }

    for (const group of groups.values()) {
      for (const commitId of group.commitIds) {
        requestedRef.current.add(`${group.organizationId}:${group.repositoryId}:${commitId}`);
      }
      getCommitPullRequestsBatch({
        organizationId: group.organizationId,
        repositoryId: group.repositoryId,
        commitIds: group.commitIds,
      })
        .then((entries) => {
          for (const entry of entries) {
            queryClient.setQueryData(
              commitPrQueryKey({
                organizationId: group.organizationId,
                repositoryId: group.repositoryId,
                commitId: entry.commitId,
              } as CommitSummary),
              entry.pullRequests,
            );
          }
        })
        .catch(() => {
          // Best-effort prefetch: leave the grid count blank and let the
          // preview panel's own query retry when the row is opened.
        });
    }
  }, [visibleCommits, queryClient]);
}
