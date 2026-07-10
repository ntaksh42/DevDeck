import { useEffect, useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { type AppSettings, listPipelineRuns, recordNotification } from "@/lib/azdoCommands";
import { showPipelineWatchNotification } from "@/lib/desktopNotifications";
import { isInProgressStatus, pipelineRunVisual, shortBranch } from "./pipelineStatus";
import {
  loadPipelineSubscriptions,
  pipelineSubscriptionHistoryQueryKey,
  PIPELINE_SUBSCRIPTIONS_CHANGED_EVENT,
  type PipelineSubscription,
  subscriptionKey,
} from "./pipelineSubscriptionsStorage";

// Background poll cadence for watched pipelines. Faster than the board's idle
// 60s so a start/finish is noticed reasonably promptly, but slow enough that
// watching many pipelines does not flood the API.
const WATCH_POLL_INTERVAL_MS = 30_000;

export type WatchedRunState = { buildId: number; inProgress: boolean };

// Compares the latest run we have already reacted to (`prev`) with the latest
// run we just observed (`next`) for one subscription. Returns the transition to
// notify on, or null when there is nothing new. The first observation has no
// `prev`, so it only establishes a baseline and never notifies.
export function detectPipelineTransition(
  prev: WatchedRunState | undefined,
  next: WatchedRunState,
): "started" | "finished" | null {
  if (!prev) return null;
  if (next.buildId === prev.buildId) {
    if (prev.inProgress && !next.inProgress) return "finished";
    if (!prev.inProgress && next.inProgress) return "started";
    return null;
  }
  // A newer run is now the latest one. If it is still running the pipeline just
  // kicked off; if it is already done the run completed between two polls and we
  // missed the start, which is still worth a "finished" notification.
  return next.inProgress ? "started" : "finished";
}

// Polls every watched pipeline app-wide (regardless of the active view) and
// raises a desktop notification when a watched pipeline's latest run starts
// running or finishes. Polling is gated on desktop notifications being enabled,
// so it issues no requests when the feature is off. Query keys mirror
// PipelineSubscriptionsBoard so the two share one cache entry — and one network
// request — whenever the Pipelines view is open.
export function usePipelineWatchNotifications(settings: AppSettings | null): void {
  const enabled = !!settings?.desktopNotificationsEnabled;
  const queryClient = useQueryClient();
  const [subscriptions, setSubscriptions] = useState<PipelineSubscription[]>(() =>
    loadPipelineSubscriptions(),
  );

  useEffect(() => {
    const reload = () => setSubscriptions(loadPipelineSubscriptions());
    window.addEventListener(PIPELINE_SUBSCRIPTIONS_CHANGED_EVENT, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(PIPELINE_SUBSCRIPTIONS_CHANGED_EVENT, reload);
      window.removeEventListener("storage", reload);
    };
  }, []);

  const queries = useQueries({
    queries: subscriptions.map((sub) => ({
      queryKey: pipelineSubscriptionHistoryQueryKey(
        sub.organizationId,
        sub.projectId,
        sub.definitionId,
      ),
      queryFn: () =>
        listPipelineRuns({
          organizationId: sub.organizationId,
          projectId: sub.projectId,
          definitionId: sub.definitionId,
        }),
      enabled,
      refetchInterval: WATCH_POLL_INTERVAL_MS,
    })),
  });

  const lastSeenRef = useRef<Map<string, WatchedRunState>>(new Map());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Re-run detection only when a latest run actually changes, not on every poll
  // that returns identical data.
  const fingerprint = subscriptions
    .map((sub, index) => {
      const key = subscriptionKey(sub.organizationId, sub.projectId, sub.definitionId);
      const latest = queries[index]?.data?.[0];
      if (!latest) return `${key}:none`;
      return `${key}:${latest.buildId}:${isInProgressStatus(latest.status) ? 1 : 0}`;
    })
    .join("|");

  useEffect(() => {
    if (!enabled) {
      // Drop baselines so re-enabling notifications does not replay transitions
      // that happened while they were off.
      lastSeenRef.current.clear();
      return;
    }
    const settingsValue = settingsRef.current;
    if (!settingsValue) return;
    subscriptions.forEach((sub, index) => {
      const latest = queries[index]?.data?.[0];
      if (!latest) return;
      const key = subscriptionKey(sub.organizationId, sub.projectId, sub.definitionId);
      const next: WatchedRunState = {
        buildId: latest.buildId,
        inProgress: isInProgressStatus(latest.status),
      };
      const transition = detectPipelineTransition(lastSeenRef.current.get(key), next);
      lastSeenRef.current.set(key, next);
      if (!transition) return;
      const visual = pipelineRunVisual(latest.status, latest.result);
      void showPipelineWatchNotification(
        {
          transition,
          definitionName: sub.definitionName,
          projectName: sub.projectName,
          buildNumber: latest.buildNumber,
          sourceBranch: latest.sourceBranch ? shortBranch(latest.sourceBranch) : null,
          resultLabel: visual.label,
          webUrl: latest.webUrl,
        },
        settingsValue,
      );
      // Persisted alongside the toast so the Notifications view has a history
      // of the same start/finish events, even after the toast disappears.
      const runDetail = [
        latest.buildNumber ? `#${latest.buildNumber}` : null,
        latest.sourceBranch ? shortBranch(latest.sourceBranch) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      recordNotification({
        organizationId: sub.organizationId,
        kind: transition === "started" ? "pipelineWatchStarted" : "pipelineWatchFinished",
        title:
          transition === "started"
            ? `Pipeline started: ${sub.definitionName}`
            : `Pipeline ${visual.label.toLowerCase()}: ${sub.definitionName}`,
        body: runDetail ? `${runDetail}\n${sub.projectName}` : sub.projectName,
        payload: {
          definitionName: sub.definitionName,
          projectName: sub.projectName,
          buildNumber: latest.buildNumber,
          sourceBranch: latest.sourceBranch,
          webUrl: latest.webUrl,
        },
      })
        .then(() => queryClient.invalidateQueries({ queryKey: ["notifications"] }))
        .catch((error) => console.error("Failed to record pipeline notification", error));
    });
    // `subscriptions`/`queries` are read fresh each render and are consistent
    // with `fingerprint`, so depending on the fingerprint is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, enabled]);
}
