import { ActiveFilters } from "@/components/ActiveFilters";
import { itemCount, ListStatusBar } from "@/components/ListStatusBar";
import { formatRelativeDate } from "@/lib/utils";
import type { WorkItemSummary } from "@/lib/azdoCommands";

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
  archivedKeys,
  snoozeEnabled,
  showSnoozed,
  setShowSnoozed,
  snoozedCount,
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
  archivedKeys: Set<string>;
  snoozeEnabled: boolean;
  showSnoozed: boolean;
  setShowSnoozed: React.Dispatch<React.SetStateAction<boolean>>;
  snoozedCount: number;
  activeFilterCount: number;
  clearAllFilters: () => void;
  staleOnly: boolean;
  setStaleOnly: React.Dispatch<React.SetStateAction<boolean>>;
  staleCount: number;
  staleThresholdDays: number;
  setColumnMenuRect: React.Dispatch<React.SetStateAction<DOMRect | null>>;
}) {
  const count = loading
    ? "Loading…"
    : searched
      ? hasActiveColumnFilters
        ? `${displayed.length} of ${itemCount(sorted.length)}`
        : itemCount(displayed.length)
      : "No search yet";
  return (
    <ListStatusBar
      summary={[
        count,
        dataUpdatedAt ? (
          <span key="updated" title={new Date(dataUpdatedAt).toLocaleString()}>
            updated {formatRelativeDate(new Date(dataUpdatedAt).toISOString())}
          </span>
        ) : null,
        isFetching ? "refreshing…" : null,
      ]}
      filters={<ActiveFilters count={activeFilterCount} onClear={clearAllFilters} />}
      done={
        triageScope
          ? { count: archivedKeys.size, active: showDone, onToggle: () => setShowDone((value) => !value) }
          : undefined
      }
      snoozed={
        snoozeEnabled
          ? { count: snoozedCount, active: showSnoozed, onToggle: () => setShowSnoozed((value) => !value) }
          : undefined
      }
      stale={
        staleOnly || staleCount > 0
          ? {
              count: staleCount,
              active: staleOnly,
              onToggle: () => setStaleOnly((value) => !value),
              thresholdDays: staleThresholdDays,
            }
          : undefined
      }
      onColumns={(rect) => setColumnMenuRect(rect)}
      helpSection="work-items"
    />
  );
}
