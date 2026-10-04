import { useEffect, useRef } from "react";
import {
  showWorkItemNotificationEvent,
  showPullRequestNotificationEvent,
  showSyncFailedNotificationEvent,
  type WorkItemNotificationEvent,
  type PullRequestNotificationEvent,
  type SyncFailedEvent,
} from "@/lib/desktopNotifications";
import { subscribeTauriEvent } from "@/lib/tauriEvents";
import type { AppSettings } from "@/lib/azdoCommands";

export type NotificationListView = "myReviews" | "myWorkItems";

// `onOpenView` lets a clicked summary notification ("5 pull request updates")
// open the matching list in the app instead of a single item in the browser.
export function useNotificationEvents(
  appSettings: AppSettings | null | undefined,
  onOpenView?: (view: NotificationListView) => void,
): void {
  const onOpenViewRef = useRef(onOpenView);
  onOpenViewRef.current = onOpenView;
  const openListFor = (view: NotificationListView) =>
    onOpenViewRef.current ? () => onOpenViewRef.current?.(view) : undefined;
  const appSettingsRef = useRef<AppSettings | null>(null);
  // Notification events that arrived before settings finished loading. They are
  // replayed once settings are available so the first events are not dropped.
  const pendingWorkItemEventsRef = useRef<WorkItemNotificationEvent[]>([]);
  const pendingPullRequestEventsRef = useRef<PullRequestNotificationEvent[]>([]);
  const pendingSyncFailedEventsRef = useRef<SyncFailedEvent[]>([]);

  useEffect(() => {
    const settings = appSettings ?? null;
    appSettingsRef.current = settings;
    if (!settings) return;
    // Replay events that arrived before settings were ready.
    const workItemEvents = pendingWorkItemEventsRef.current;
    const pullRequestEvents = pendingPullRequestEventsRef.current;
    const syncFailedEvents = pendingSyncFailedEventsRef.current;
    pendingWorkItemEventsRef.current = [];
    pendingPullRequestEventsRef.current = [];
    pendingSyncFailedEventsRef.current = [];
    for (const event of workItemEvents) {
      void showWorkItemNotificationEvent(event, settings, openListFor("myWorkItems"));
    }
    for (const event of pullRequestEvents) {
      void showPullRequestNotificationEvent(event, settings, openListFor("myReviews"));
    }
    for (const event of syncFailedEvents) {
      void showSyncFailedNotificationEvent(event, settings);
    }
  }, [appSettings]);

  useEffect(() => {
    return subscribeTauriEvent<WorkItemNotificationEvent>(
      "notifications:work-items",
      (payload) => {
        const settings = appSettingsRef.current;
        if (!settings) {
          pendingWorkItemEventsRef.current.push(payload);
          return;
        }
        void showWorkItemNotificationEvent(payload, settings, openListFor("myWorkItems"));
      },
    );
  }, []);

  useEffect(() => {
    return subscribeTauriEvent<PullRequestNotificationEvent>(
      "notifications:pull-requests",
      (payload) => {
        const settings = appSettingsRef.current;
        if (!settings) {
          pendingPullRequestEventsRef.current.push(payload);
          return;
        }
        void showPullRequestNotificationEvent(payload, settings, openListFor("myReviews"));
      },
    );
  }, []);

  useEffect(() => {
    return subscribeTauriEvent<SyncFailedEvent>(
      "notifications:sync-failed",
      (payload) => {
        const settings = appSettingsRef.current;
        if (!settings) {
          pendingSyncFailedEventsRef.current.push(payload);
          return;
        }
        void showSyncFailedNotificationEvent(payload, settings);
      },
    );
  }, []);
}
