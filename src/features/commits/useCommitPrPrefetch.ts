import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { type CommitSummary, getCommitPullRequestsBatch } from "@/lib/azdoCommands";
import { commitPrQueryKey } from "./commitSearchUtils";

// Commits per Pull Request Query call; a repository with more visible commits
// than this is fetched in several calls.
const BATCH_SIZE = 25;
// Scrolling through the grid should not fire a request per frame.
const DEBOUNCE_MS = 250;

// Fills the grid's PR column for the rows in view: after a short pause, the
// visible commits that have no cached lookup yet are fetched in batched
// requests (one per repository per BATCH_SIZE commits) and written into the same
// query cache the preview's per-commit lookup uses, so selecting a row later is
// free. Failures are ignored; the preview still fetches a commit on demand.
export function useCommitPrPrefetch(visibleCommits: CommitSummary[]): void {
  const queryClient = useQueryClient();
  // A stable signature so the effect only restarts when the window changes.
  const signature = visibleCommits
    .map((commit) => `${commit.organizationId}:${commit.repositoryId}:${commit.commitId}`)
    .join("|");

  useEffect(() => {
    const pending = visibleCommits.filter(
      (commit) => queryClient.getQueryData(commitPrQueryKey(commit)) === undefined,
    );
    if (pending.length === 0) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      const groups = new Map<string, CommitSummary[]>();
      for (const commit of pending) {
        const key = `${commit.organizationId}|${commit.repositoryId}`;
        groups.set(key, [...(groups.get(key) ?? []), commit]);
      }
      for (const commits of groups.values()) {
        for (let start = 0; start < commits.length; start += BATCH_SIZE) {
          const chunk = commits.slice(start, start + BATCH_SIZE);
          void getCommitPullRequestsBatch({
            organizationId: chunk[0].organizationId,
            repositoryId: chunk[0].repositoryId,
            commitIds: chunk.map((commit) => commit.commitId),
          })
            .then((byCommit) => {
              if (cancelled) return;
              for (const commit of chunk) {
                queryClient.setQueryData(commitPrQueryKey(commit), byCommit[commit.commitId] ?? []);
              }
            })
            .catch(() => {
              // Best effort: leave the cells empty; the preview fetches on demand.
            });
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `signature` captures the visible commits; the array identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, queryClient]);
}
