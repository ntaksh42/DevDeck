import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  loadUsageStats,
  resetUsageStats,
  USAGE_STATS_CHANGED_EVENT,
  type UsageStats,
} from '@/lib/usageStats';
import { useExperimentalFlag } from './useExperimentalFlags';

const FIELDS: { key: keyof UsageStats; label: string }[] = [
  { key: 'votes', label: 'Review votes' },
  { key: 'resolvedThreads', label: 'Resolved threads' },
  { key: 'stateChanges', label: 'State changes' },
];

export function ExperimentalUsageStats() {
  const enabled = useExperimentalFlag('usageStats');
  const [stats, setStats] = useState<UsageStats>(loadUsageStats);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    function refresh() {
      setStats(loadUsageStats());
    }
    refresh();
    window.addEventListener(USAGE_STATS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(USAGE_STATS_CHANGED_EVENT, refresh);
  }, [enabled]);

  // The panel only exists while the experiment is on, so there is no empty
  // section sitting in Settings for everyone else.
  if (!enabled) {
    return null;
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <BarChart3 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Usage stats</h2>
            <p className="text-sm text-muted-foreground">
              Counted on this machine only. Nothing is sent anywhere.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-3">
        <dl className="grid gap-2 sm:grid-cols-3">
          {FIELDS.map(({ key, label }) => (
            <div key={key} className="rounded-md border border-border px-3 py-2">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{stats[key]}</dd>
            </div>
          ))}
        </dl>

        <div>
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-secondary"
          >
            Reset counts
          </button>
        </div>
      </div>

      {confirmReset && (
        <ConfirmDialog
          title="Reset usage stats?"
          message="This clears the counts stored on this machine. It cannot be undone."
          confirmLabel="Reset"
          destructive
          onConfirm={() => {
            resetUsageStats();
            setConfirmReset(false);
          }}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}
