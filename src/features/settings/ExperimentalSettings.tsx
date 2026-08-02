import { type FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Loader2 } from 'lucide-react';
import {
  commandErrorMessage,
  getAppSettings,
  updateAppSettings,
} from '@/lib/azdoCommands';
import { settingsInput } from './settingsHelpers';

type ExperimentFields = {
  experimentalUsageStats: boolean;
  experimentalRetryToasts: boolean;
  experimentalAutoUpdateCheck: boolean;
};

const EXPERIMENTS: {
  field: keyof ExperimentFields;
  label: string;
  description: string;
}[] = [
  {
    field: 'experimentalUsageStats',
    label: 'Local usage stats',
    description:
      'Count your own review votes, resolved threads, and state changes locally. Never sent anywhere.',
  },
  {
    field: 'experimentalRetryToasts',
    label: 'Retry toasts on failure',
    description:
      'Show a dismissible toast with a Retry button when an action fails.',
  },
  {
    field: 'experimentalAutoUpdateCheck',
    label: 'Automatic update check',
    description: 'Check for a new release on startup instead of only on demand.',
  },
];

const ALL_OFF: ExperimentFields = {
  experimentalUsageStats: false,
  experimentalRetryToasts: false,
  experimentalAutoUpdateCheck: false,
};

export function ExperimentalSettings() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const [master, setMaster] = useState(false);
  const [experiments, setExperiments] = useState<ExperimentFields>(ALL_OFF);

  useEffect(() => {
    const settings = settingsQuery.data;
    setMaster(settings?.experimentalFeaturesEnabled ?? false);
    setExperiments({
      experimentalUsageStats: settings?.experimentalUsageStats ?? false,
      experimentalRetryToasts: settings?.experimentalRetryToasts ?? false,
      experimentalAutoUpdateCheck:
        settings?.experimentalAutoUpdateCheck ?? false,
    });
  }, [settingsQuery.data]);

  const mutation = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(["appSettings"], settings);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate(
      settingsInput(settingsQuery.data, {
        experimentalFeaturesEnabled: master,
        ...experiments,
      }),
    );
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <FlaskConical className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Experimental</h2>
            <p className="text-sm text-muted-foreground">
              Try unfinished features. These may change or be removed without notice.
            </p>
          </div>
        </div>
      </div>

      <form className="grid gap-3 p-3" onSubmit={onSubmit}>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={master}
            onChange={(event) => setMaster(event.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Enable experimental features
        </label>
        <p className="text-sm text-muted-foreground">
          Master switch. Individual experiments below only take effect while this is on.
        </p>

        <div className="border-t border-border pt-3">
          <p className="mb-2 text-sm font-medium">Experiments</p>
          <div className="grid gap-3">
            {EXPERIMENTS.map(({ field, label, description }) => (
              <div key={field} className="grid gap-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={experiments[field]}
                    disabled={!master}
                    onChange={(event) =>
                      setExperiments((current) => ({
                        ...current,
                        [field]: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-input"
                  />
                  {label}
                </label>
                <p className="pl-6 text-sm text-muted-foreground">{description}</p>
              </div>
            ))}
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
          <p className="text-sm text-green-700 dark:text-green-400">
            Experimental settings saved.
          </p>
        ) : null}

        <div>
          <button
            type="submit"
            disabled={settingsQuery.isLoading || mutation.isPending}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FlaskConical className="h-4 w-4" aria-hidden="true" />
            )}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
