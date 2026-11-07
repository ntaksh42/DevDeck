import { useAgentWaiting } from "./useAgentWaiting";

/**
 * How many agent conversations are waiting for the user, across every item and
 * free-standing request, so it can be seen from any View.
 */
export function useAgentNeedsYouBadge(): number | null {
  const count = useAgentWaiting().reduce((total, waiting) => total + waiting.count, 0);
  return count > 0 ? count : null;
}
