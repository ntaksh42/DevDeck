import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  summarizeAgentNotes,
  type AgentNoteSummary,
  type AgentNoteTarget,
  type AppSettings,
} from "@/lib/azdoCommands";
import { navigateToPullRequest, navigateToWorkItem } from "@/lib/crossLinks";
import { showAgentNoteNotification } from "@/lib/desktopNotifications";
import { SEEN_CHANGED_EVENT } from "./noteSeen";

// Per-item note counts for one result folder. The files change outside
// DevDeck (the agent edits them), so the summary is polled; it is a cheap
// local directory scan. One shared query per target backs the grid badges,
// the open panel's refresh, and desktop notifications.

const POLL_MS = 5_000;

export const agentNoteSummariesKey = (target: AgentNoteTarget) => ["agentNoteSummaries", target];

function useSummaries(target: AgentNoteTarget) {
  return useQuery({
    queryKey: agentNoteSummariesKey(target),
    queryFn: () => summarizeAgentNotes({ target }),
    refetchInterval: POLL_MS,
    // Folder not set or missing: no badges, no noise.
    retry: false,
  });
}

export function useAgentNoteSummary(
  target: AgentNoteTarget,
  itemId: number,
): AgentNoteSummary | null {
  const { data } = useSummaries(target);
  return data?.find((summary) => summary.itemId === itemId) ?? null;
}

/** Re-renders when the user marks agent replies as seen. */
export function useSeenVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(SEEN_CHANGED_EVENT, bump);
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener(SEEN_CHANGED_EVENT, bump);
      window.removeEventListener("storage", bump);
    };
  }, []);
  return version;
}

/**
 * App-wide: refreshes an item's note list as soon as its files change, and
 * raises a desktop notification when an agent replies or finishes a note.
 * The first poll only sets the baseline.
 */
export function useAgentNoteWatcher(settings: AppSettings | null) {
  const queryClient = useQueryClient();
  const workItems = useSummaries("work-item");
  const pullRequests = useSummaries("pull-request");
  const previous = useRef(new Map<string, AgentNoteSummary>());
  const baselined = useRef(new Set<AgentNoteTarget>());
  const notify = !!settings?.desktopNotificationsEnabled;

  useEffect(() => {
    for (const [target, data] of [
      ["work-item", workItems.data],
      ["pull-request", pullRequests.data],
    ] as const) {
      if (!data) continue;
      const first = !baselined.current.has(target);
      baselined.current.add(target);
      for (const summary of data) {
        const key = `${target}:${summary.itemId}`;
        const before = previous.current.get(key);
        previous.current.set(key, summary);
        if (before && before.lastModifiedAt !== summary.lastModifiedAt) {
          void queryClient.invalidateQueries({ queryKey: ["agentNotes", target, summary.itemId] });
        }
        if (first || !notify) continue;
        const replied =
          !!summary.lastAgentReplyAt && summary.lastAgentReplyAt !== (before?.lastAgentReplyAt ?? null);
        const finished = summary.done > (before?.done ?? 0);
        if (!replied && !finished) continue;
        const label = target === "pull-request" ? `PR !${summary.itemId}` : `#${summary.itemId}`;
        void showAgentNoteNotification({
          title: replied ? `Agent replied on ${label}` : `Agent finished a note on ${label}`,
          body: summary.needsYou
            ? `${summary.needsYou} note${summary.needsYou === 1 ? "" : "s"} waiting for you`
            : `${summary.open} open, ${summary.done} done`,
          onClick: () =>
            target === "pull-request"
              ? navigateToPullRequest({ pullRequestId: summary.itemId })
              : navigateToWorkItem({ workItemId: summary.itemId }),
        });
      }
    }
  }, [workItems.data, pullRequests.data, notify, queryClient]);
}
