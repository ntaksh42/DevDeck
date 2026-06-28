import { type FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Loader2, Send } from 'lucide-react';
import {
  commandErrorMessage,
  getAppSettings,
  updateAppSettings,
} from '@/lib/azdoCommands';
import { sendTestDesktopNotification } from "@/lib/desktopNotifications";
import { settingsInput } from './settingsHelpers';

export function DesktopNotificationSettings() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const [enabled, setEnabled] = useState(false);
  const [contentPreviewEnabled, setContentPreviewEnabled] = useState(true);
  const [assignmentsEnabled, setAssignmentsEnabled] = useState(true);
  const [stateChangesEnabled, setStateChangesEnabled] = useState(true);
  const [prReviewRequests, setPrReviewRequests] = useState(true);
  const [prVoteResets, setPrVoteResets] = useState(true);
  const [prCommentReplies, setPrCommentReplies] = useState(true);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    const settings = settingsQuery.data;
    setEnabled(settings?.desktopNotificationsEnabled ?? false);
    setContentPreviewEnabled(settings?.notificationContentPreviewEnabled ?? true);
    setAssignmentsEnabled(settings?.notifyWorkItemAssignments ?? true);
    setStateChangesEnabled(settings?.notifyWorkItemStateChanges ?? true);
    setPrReviewRequests(settings?.notifyPrReviewRequests ?? true);
    setPrVoteResets(settings?.notifyPrVoteResets ?? true);
    setPrCommentReplies(settings?.notifyPrCommentReplies ?? true);
  }, [settingsQuery.data]);

  const mutation = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(["appSettings"], settings);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTestResult(null);
    mutation.mutate(
      settingsInput(settingsQuery.data, {
        desktopNotificationsEnabled: enabled,
        notificationContentPreviewEnabled: contentPreviewEnabled,
        notifyWorkItemAssignments: assignmentsEnabled,
        notifyWorkItemStateChanges: stateChangesEnabled,
        notifyPrReviewRequests: prReviewRequests,
        notifyPrVoteResets: prVoteResets,
        notifyPrCommentReplies: prCommentReplies,
      }),
    );
  }

  async function onSendTestNotification() {
    setTestResult(null);
    const result = await sendTestDesktopNotification();
    if (result === "sent") {
      setTestResult("Test notification sent.");
    } else if (result === "unsupported") {
      setTestResult("Desktop notifications are not supported in this runtime.");
    } else {
      setTestResult("Desktop notification permission was not granted.");
    }
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Bell className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Desktop notifications</h2>
            <p className="text-sm text-muted-foreground">
              Notify after sync about work item changes and pull request review
              requests, vote resets, and replies.
            </p>
          </div>
        </div>
      </div>

      <form className="grid gap-3 p-3" onSubmit={onSubmit}>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Enable desktop notifications
        </label>
        <div className="grid gap-2 md:grid-cols-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={assignmentsEnabled}
              onChange={(event) => setAssignmentsEnabled(event.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Assigned work items
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={stateChangesEnabled}
              onChange={(event) => setStateChangesEnabled(event.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            State changes
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={contentPreviewEnabled}
              onChange={(event) => setContentPreviewEnabled(event.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Show title in notification
          </label>
        </div>
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-sm font-medium">Pull requests</p>
          <div className="grid gap-2 md:grid-cols-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prReviewRequests}
                onChange={(event) => setPrReviewRequests(event.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              New review requests
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prVoteResets}
                onChange={(event) => setPrVoteResets(event.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Vote resets
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prCommentReplies}
                onChange={(event) => setPrCommentReplies(event.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Comment replies &amp; mentions
            </label>
          </div>
        </div>

        {settingsQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(settingsQuery.error)}
          </p>
        ) : null}

        {mutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(mutation.error)}
          </p>
        ) : null}

        {mutation.isSuccess ? (
          <p className="text-sm text-green-700 dark:text-green-400">Desktop notification settings saved.</p>
        ) : null}

        {testResult ? <p className="text-sm text-muted-foreground">{testResult}</p> : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={settingsQuery.isLoading || mutation.isPending}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Bell className="h-4 w-4" aria-hidden="true" />
            )}
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              void onSendTestNotification();
            }}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-secondary"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            Send test
          </button>
        </div>
      </form>
    </div>
  );
}
