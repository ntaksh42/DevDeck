import { useQuery } from '@tanstack/react-query';
import { getAppSettings } from '@/lib/azdoCommands';

export type ExperimentalFlagName =
  | 'usageStats'
  | 'retryToasts'
  | 'autoUpdateCheck';

export type ExperimentalFlags = Record<ExperimentalFlagName, boolean>;

const ALL_OFF: ExperimentalFlags = {
  usageStats: false,
  retryToasts: false,
  autoUpdateCheck: false,
};

function useAppSettings() {
  return useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
}

/// Whether the experimental section itself is on. Only the settings screen
/// should need this; feature code wants the resolved flags below instead.
export function useExperimentalMaster(): boolean {
  const settingsQuery = useAppSettings();
  return settingsQuery.data?.experimentalFeaturesEnabled ?? false;
}

/**
 * Resolved experimental flags: each is on only while the master switch is also
 * on. Feature code reads flags through this so the master switch cannot be
 * bypassed, and so turning the master off never discards the individual
 * choices stored in settings.
 */
export function useExperimentalFlags(): ExperimentalFlags {
  const settingsQuery = useAppSettings();
  const settings = settingsQuery.data;
  if (!settings?.experimentalFeaturesEnabled) {
    return ALL_OFF;
  }
  return {
    usageStats: settings.experimentalUsageStats,
    retryToasts: settings.experimentalRetryToasts,
    autoUpdateCheck: settings.experimentalAutoUpdateCheck,
  };
}

export function useExperimentalFlag(name: ExperimentalFlagName): boolean {
  return useExperimentalFlags()[name];
}
