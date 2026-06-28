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

export function useNotificationEvents(appSettings: AppSettings | null | undefined): void {
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
      void showWorkItemNotificationEvent(event, settings);
    }
    for (const event of pullRequestEvents) {
      void showPullRequestNotificationEvent(event, settings);
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
        void showWorkItemNotificationEvent(payload, settings);
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
        void showPullRequestNotificationEvent(payload, settings);
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
