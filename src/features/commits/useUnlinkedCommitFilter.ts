import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { type CommitSummary, getCommitPullRequests } from "@/lib/azdoCommands";
import { extractWorkItemMentions } from "@/lib/crossLinks";
import { commitPrQueryKey } from "./commitSearchUtils";
import { isUnlinkedCommit } from "./commitLinks";
import { useCommitPrPrefetch } from "./useCommitPrPrefetch";

// "Unlinked only" filter. While on, every commit without an `AB#` mention gets
// its related-PR lookup (batched, like the visible-window prefetch) so the whole
// result set can be classified, not just the rows in view. Commits whose lookup
// is still pending are hidden until it finishes; `pending` reports how many.
export function useUnlinkedCommitFilter(results: CommitSummary[]) {
  const [enabled, setEnabled] = useState(false);

  const candidates = useMemo(
    () =>
      enabled
        ? results.filter((commit) => extractWorkItemMentions([commit.comment]).length === 0)
        : [],
    [enabled, results],
  );
  useCommitPrPrefetch(candidates);

  // Read-only subscription to the cache entries the prefetch fills.
  const prCounts = useQueries({
    queries: candidates.map((commit) => ({
      queryKey: commitPrQueryKey(commit),
      queryFn: () => getCommitPullRequests(commit),
      enabled: false,
    })),
  }).map((query) => query.data?.length);

  const unlinked = useMemo(
    () => candidates.filter((commit, index) => isUnlinkedCommit(commit, prCounts[index])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidates, prCounts.join(",")],
  );
  const pending = prCounts.filter((count) => count === undefined).length;

  return {
    enabled,
    toggle: () => setEnabled((value) => !value),
    rows: enabled ? unlinked : results,
    pending,
  };
}
