import { type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import {
  commandErrorMessage,
  getAppSettings,
  updateAppSettings,
  DEFAULT_REVIEW_STALE_THRESHOLD_DAYS,
  DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS,
  REVIEW_STALE_THRESHOLD_DAY_OPTIONS,
  WORK_ITEM_STALE_THRESHOLD_DAY_OPTIONS,
} from '@/lib/azdoCommands';
import { settingsInput } from './settingsHelpers';

export function ReviewStaleThresholdSettings() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(["appSettings"], settings);
    },
  });

  const value =
    settingsQuery.data?.reviewStaleThresholdDays ??
    DEFAULT_REVIEW_STALE_THRESHOLD_DAYS;

  function onChange(event: ChangeEvent<HTMLSelectElement>) {
    const days = Number(event.target.value);
    mutation.mutate(
      settingsInput(settingsQuery.data, { reviewStaleThresholdDays: days }),
    );
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Clock className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">My Reviews</h2>
            <p className="text-sm text-muted-foreground">
              Highlight review requests as stale after this many days.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-3">
        <label className="grid gap-2">
          <span className="text-sm font-medium">Stale review threshold</span>
          <select
            value={value}
            onChange={onChange}
            disabled={settingsQuery.isLoading || mutation.isPending}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {REVIEW_STALE_THRESHOLD_DAY_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
        </label>

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
          <p className="text-sm text-green-700 dark:text-green-400">
            Stale review threshold saved.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function WorkItemStaleThresholdSettings() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(["appSettings"], settings);
    },
  });

  const value =
    settingsQuery.data?.workItemStaleThresholdDays ??
    DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS;

  function onChange(event: ChangeEvent<HTMLSelectElement>) {
    const days = Number(event.target.value);
    mutation.mutate(
      settingsInput(settingsQuery.data, { workItemStaleThresholdDays: days }),
    );
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Clock className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">My Work Items</h2>
            <p className="text-sm text-muted-foreground">
              Flag active work items as stale after this many days without a change.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-3">
        <label className="grid gap-2">
          <span className="text-sm font-medium">Stale work item threshold</span>
          <select
            value={value}
            onChange={onChange}
            disabled={settingsQuery.isLoading || mutation.isPending}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {WORK_ITEM_STALE_THRESHOLD_DAY_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
        </label>

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
          <p className="text-sm text-green-700 dark:text-green-400">
            Stale work item threshold saved.
          </p>
        ) : null}
      </div>
    </div>
  );
}
