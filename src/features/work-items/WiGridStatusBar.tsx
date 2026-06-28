import { AlertTriangle } from 'lucide-react';
import { ActiveFilters } from '@/components/ActiveFilters';
import { formatRelativeDate } from '@/lib/utils';
import type { WorkItemSummary } from '@/lib/azdoCommands';

export function WiGridStatusBar({
  loading,
  searched,
  hasActiveColumnFilters,
  displayed,
  sorted,
  dataUpdatedAt,
  isFetching,
  triageScope,
  showDone,
  setShowDone,
  setSelectedIndex,
  archivedKeys,
  snoozeEnabled,
  showSnoozed,
  setShowSnoozed,
  activeFilterCount,
  clearAllFilters,
  staleOnly,
  setStaleOnly,
  staleCount,
  staleThresholdDays,
  setColumnMenuRect,
}: {
  loading: boolean;
  searched: boolean;
  hasActiveColumnFilters: boolean;
  displayed: WorkItemSummary[];
  sorted: WorkItemSummary[];
  dataUpdatedAt?: number;
  isFetching: boolean;
  triageScope?: string;
  showDone: boolean;
  setShowDone: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedIndex: (i: number) => void;
  archivedKeys: Set<string>;
  snoozeEnabled: boolean;
  showSnoozed: boolean;
  setShowSnoozed: React.Dispatch<React.SetStateAction<boolean>>;
  activeFilterCount: number;
  clearAllFilters: () => void;
  staleOnly: boolean;
  setStaleOnly: React.Dispatch<React.SetStateAction<boolean>>;
  staleCount: number;
  staleThresholdDays: number;
  setColumnMenuRect: React.Dispatch<React.SetStateAction<DOMRect | null>>;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1 text-xs text-muted-foreground">
      <span className="flex min-w-0 items-center gap-3">
        <span className="shrink-0">
          {loading
            ? "Loading…"
            : searched
              ? hasActiveColumnFilters
                ? `${displayed.length} of ${sorted.length} item${sorted.length === 1 ? "" : "s"}`
                : `${displayed.length} item${displayed.length === 1 ? "" : "s"}`
              : "Ready"}
          {dataUpdatedAt ? (
            <span title={new Date(dataUpdatedAt).toLocaleString()}>
              {" · "}
              Updated {formatRelativeDate(new Date(dataUpdatedAt).toISOString())}
            </span>
          ) : null}
          {isFetching ? <span>{" · "}Refreshing…</span> : null}
        </span>
      </span>
      <span className="flex items-center gap-2">
        {triageScope ? (
          <button
            type="button"
            aria-pressed={showDone}
            title="Toggle done view (E marks the selected row done)"
            onClick={() => {
              setShowDone((value) => !value);
              setSelectedIndex(0);
            }}
            className={`rounded border px-2 py-0.5 text-xs ${
              showDone
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card hover:bg-secondary"
            }`}
          >
            {showDone ? "Back to inbox" : `Done (${archivedKeys.size})`}
          </button>
        ) : null}
        {snoozeEnabled ? (
          <button
            type="button"
            aria-pressed={showSnoozed}
            title="Toggle snoozed view (Z snoozes the selected row)"
            onClick={() => {
              setShowSnoozed((value) => !value);
              setSelectedIndex(0);
            }}
            className={`rounded border px-2 py-0.5 text-xs ${
              showSnoozed
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card hover:bg-secondary"
            }`}
          >
            {showSnoozed ? "Back to inbox" : "Snoozed"}
          </button>
        ) : null}
        <ActiveFilters count={activeFilterCount} onClear={clearAllFilters} />
        {staleOnly || staleCount > 0 ? (
          <button
            type="button"
            aria-pressed={staleOnly}
            title={`Show only stale items (no change in ${staleThresholdDays}+ days)`}
            onClick={() => {
              setStaleOnly((value) => !value);
              setSelectedIndex(0);
            }}
            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs ${
              staleOnly
                ? "border-orange-500 bg-orange-500/10 text-orange-700 dark:text-orange-300"
                : "border-border bg-card hover:bg-secondary"
            }`}
          >
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            Stale ({staleCount})
          </button>
        ) : null}
        <button
          type="button"
          onClick={(event) => setColumnMenuRect(event.currentTarget.getBoundingClientRect())}
          className="rounded border border-border bg-card px-2 py-0.5 text-xs hover:bg-secondary"
        >
          Columns
        </button>
      </span>
    </div>
  );
}
