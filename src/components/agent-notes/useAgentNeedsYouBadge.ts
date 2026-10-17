import { useQuery } from "@tanstack/react-query";
import { listAgentAsks, noteNeedsYou } from "@/lib/azdoCommands";
import { useSummaries } from "./useAgentNoteSummaries";

/**
 * How many agent conversations are waiting for the user, across every item and
 * free-standing request, so it can be seen from any View. Reuses the polled
 * note summaries; the asks list is a cheap local directory scan as well.
 */
export function useAgentNeedsYouBadge(): number | null {
  const prSummaries = useSummaries("pull-request");
  const wiSummaries = useSummaries("work-item");
  const asks = useQuery({
    queryKey: ["agentAsks", "needsYou"],
    queryFn: listAgentAsks,
    refetchInterval: 5_000,
    retry: false,
  });
  const itemCount = [prSummaries.data, wiSummaries.data].reduce(
    (total, summaries) => total + (summaries ?? []).reduce((sum, s) => sum + s.needsYou, 0),
    0,
  );
  const askCount = (asks.data ?? []).reduce(
    (total, ask) => total + ask.notes.filter(noteNeedsYou).length,
    0,
  );
  const count = itemCount + askCount;
  return count > 0 ? count : null;
}
