import { type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { SettingsRow } from './SettingsRow';

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
    <SettingsRow
      title="My Reviews"
      description={<>Highlight review requests as stale after this many days.</>}
    >
      <div className="grid gap-3">
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
          <p className="text-sm text-success">
            Stale review threshold saved.
          </p>
        ) : null}
      </div>
    </SettingsRow>
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
    <SettingsRow
      title="My Work Items"
      description={<>Flag active work items as stale after this many days without a change.</>}
    >
      <div className="grid gap-3">
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
          <p className="text-sm text-success">
            Stale work item threshold saved.
          </p>
        ) : null}
      </div>
    </SettingsRow>
  );
}
