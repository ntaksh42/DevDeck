import { AlertTriangle } from 'lucide-react';
import type { ReviewPullRequestSummary } from '@/lib/azdoCommands';
import { ActiveFilters } from '@/components/ActiveFilters';

type OverlapResult = { overlaps: { path: string; prKeys: string[] }[]; fileCount: number };

type ReviewStatusBarProps = {
  visiblePrs: ReviewPullRequestSummary[];
  noVoteCount: number;
  returnedKeys: Set<string>;
  isMultiSelect: boolean;
  changesLoading: boolean;
  selectedPrs: ReviewPullRequestSummary[];
  overlap: OverlapResult;
  overlapPopupOpen: boolean;
  overlapButtonRef: React.RefObject<HTMLButtonElement | null>;
  singleFileCount: number | null;
  showDone: boolean;
  archivedKeys: Set<string>;
  showSnoozed: boolean;
  activeFilterCount: number;
  sortedPrsCount: number;
  onToggleOverlapPopup: () => void;
  onToggleShowDone: () => void;
  onToggleShowSnoozed: () => void;
  onClearAllFilters: () => void;
  onOpenColumnMenu: (rect: DOMRect) => void;
};

export function ReviewStatusBar({
  visiblePrs,
  noVoteCount,
  returnedKeys,
  isMultiSelect,
  changesLoading,
  selectedPrs,
  overlap,
  overlapPopupOpen,
  overlapButtonRef,
  singleFileCount,
  showDone,
  archivedKeys,
  showSnoozed,
  activeFilterCount,
  sortedPrsCount,
  onToggleOverlapPopup,
  onToggleShowDone,
  onToggleShowSnoozed,
  onClearAllFilters,
  onOpenColumnMenu,
}: ReviewStatusBarProps) {
  return (
    <div className="flex items-center justify-between border-t border-border px-2 py-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-3">
        <span>
          {visiblePrs.length} total,{' '}
          <span className="font-medium text-foreground">{noVoteCount}</span> not voted
          {returnedKeys.size > 0 ? (
            <>
              {', '}
              <span className="font-medium text-purple-700 dark:text-purple-300">
                {returnedKeys.size}
              </span>{' '}
              returned
            </>
          ) : null}
        </span>
        {isMultiSelect ? (
          changesLoading ? (
            <span>Checking {selectedPrs.length} PRs for overlapping files…</span>
          ) : overlap.fileCount > 0 ? (
            <button
              ref={overlapButtonRef}
              type="button"
              onClick={onToggleOverlapPopup}
              aria-expanded={overlapPopupOpen}
              className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-100 px-2 py-0.5 font-medium text-amber-800 hover:bg-amber-200 focus:outline-none focus:ring-2 focus:ring-ring dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900"
              title="These selected PRs change the same files — merging them may conflict"
            >
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              Conflict risk: {overlap.fileCount} file{overlap.fileCount === 1 ? '' : 's'} overlap
            </button>
          ) : (
            <span className="text-foreground">
              {selectedPrs.length} PRs selected, no overlapping files
            </span>
          )
        ) : singleFileCount != null ? (
          <span>
            {singleFileCount} changed file{singleFileCount === 1 ? '' : 's'}
          </span>
        ) : null}
      </span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          aria-pressed={showDone}
          title="Toggle done view (E marks the selected row done)"
          onClick={onToggleShowDone}
          className={`rounded border px-2 py-0.5 text-xs ${
            showDone
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-card hover:bg-secondary'
          }`}
        >
          {showDone ? 'Back to inbox' : `Done (${archivedKeys.size})`}
        </button>
        <button
          type="button"
          aria-pressed={showSnoozed}
          title="Toggle snoozed view (Z snoozes the selected row)"
          onClick={onToggleShowSnoozed}
          className={`rounded border px-2 py-0.5 text-xs ${
            showSnoozed
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-card hover:bg-secondary'
          }`}
        >
          {showSnoozed ? 'Back to inbox' : 'Snoozed'}
        </button>
        <ActiveFilters
          count={activeFilterCount}
          shownCount={sortedPrsCount}
          onClear={onClearAllFilters}
        />
        <button
          type="button"
          onClick={(e) => onOpenColumnMenu(e.currentTarget.getBoundingClientRect())}
          className="rounded border border-border bg-card px-2 py-0.5 text-xs hover:bg-secondary"
        >
          Columns
        </button>
      </span>
    </div>
  );
}
