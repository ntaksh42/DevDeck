import { useQuery } from "@tanstack/react-query";
import { listAgentAsks, noteNeedsYou } from "@/lib/azdoCommands";
import { useSummaries } from "./useAgentNoteSummaries";

/** One place where an agent conversation waits for the user. */
export type AgentWaiting =
  | { kind: "pull-request" | "work-item"; id: number; count: number }
  | { kind: "ask"; id: number; count: number };

/**
 * Every conversation that waits for the user across all pull requests, work
 * items and free-standing requests, most recently touched first for requests.
 * The note summaries are polled by the existing grid badges; the asks list is a
 * local directory scan as well.
 */
export function useAgentWaiting(): AgentWaiting[] {
  const prSummaries = useSummaries("pull-request");
  const wiSummaries = useSummaries("work-item");
  const asks = useQuery({
    queryKey: ["agentAsks", "needsYou"],
    queryFn: listAgentAsks,
    refetchInterval: 5_000,
    retry: false,
  });
  const items = (kind: "pull-request" | "work-item", data: typeof prSummaries.data): AgentWaiting[] =>
    (data ?? [])
      .filter((summary) => summary.needsYou > 0)
      .map((summary) => ({ kind, id: summary.itemId, count: summary.needsYou }));
  const askItems: AgentWaiting[] = (asks.data ?? [])
    .map((ask) => ({
      kind: "ask" as const,
      id: ask.itemId,
      count: ask.notes.filter(noteNeedsYou).length,
    }))
    .filter((ask) => ask.count > 0);
  return [...items("pull-request", prSummaries.data), ...items("work-item", wiSummaries.data), ...askItems];
}
