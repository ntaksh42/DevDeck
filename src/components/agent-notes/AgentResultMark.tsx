import { useQuery } from "@tanstack/react-query";
import { SquareCheck } from "lucide-react";
import { listResultItemIds, type ResultTarget } from "@/lib/azdoCommands";

// The result files are written outside DevDeck (by the agent), so the id list
// is polled; it is one local directory listing per target, shared by all rows.
const POLL_MS = 15_000;

// Under the preview's query key, so saving the result folder in Settings
// (which invalidates that key) also refreshes the marks.
const resultIdsKey = (target: ResultTarget) => [
  target === "pull-request" ? "reviewResultPreview" : "workItemResultPreview",
  "ids",
];

// Module-level so the query memoizes the set across the rows' renders.
const toSet = (ids: number[]): ReadonlySet<number> => new Set(ids);

function useResultIds(target: ResultTarget): ReadonlySet<number> | undefined {
  const { data } = useQuery({
    queryKey: resultIdsKey(target),
    queryFn: () => listResultItemIds(target),
    refetchInterval: POLL_MS,
    retry: false,
    select: toSet,
  });
  return data;
}

/** Grid-row mark: the item has an AI review / investigation result file. */
export function AgentResultMark({ target, itemId }: { target: ResultTarget; itemId: number }) {
  const ids = useResultIds(target);
  if (!ids?.has(itemId)) return null;
  const label = target === "pull-request" ? "AI review result available" : "AI investigation result available";
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex shrink-0 text-info">
      <SquareCheck className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  );
}
