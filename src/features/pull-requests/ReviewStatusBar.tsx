import { AlertTriangle } from 'lucide-react';
import type { ReviewPullRequestSummary } from '@/lib/azdoCommands';
import { ActiveFilters } from '@/components/ActiveFilters';
import { itemCount, ListStatusBar } from '@/components/ListStatusBar';

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
  snoozedCount: number;
  activeFilterCount: number;
  sortedPrsCount: number;
  onToggleOverlapPopup: () => void;
  onToggleShowDone: () => void;
  onToggleShowSnoozed: () => void;
  onClearAllFilters: () => void;
  onOpenColumnMenu: (rect: DOMRect) => void;
  onSnoozeSelected: (rect: DOMRect) => void;
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
  snoozedCount,
  activeFilterCount,
  sortedPrsCount,
  onToggleOverlapPopup,
  onToggleShowDone,
  onToggleShowSnoozed,
  onClearAllFilters,
  onOpenColumnMenu,
  onSnoozeSelected,
}: ReviewStatusBarProps) {
  const summary = showSnoozed
    ? // The snoozed panel replaces the inbox grid, so inbox-derived counts and
      // selection state would describe rows that are not on screen.
      [itemCount(snoozedCount, 'snoozed')]
    : [
        itemCount(visiblePrs.length),
        <span key="not-voted">
          <span className="font-medium text-foreground">{noVoteCount}</span> not voted
        </span>,
        returnedKeys.size > 0 ? (
          <span key="returned">
            <span className="font-medium text-purple-700 dark:text-purple-300">{returnedKeys.size}</span> returned
          </span>
        ) : null,
        !isMultiSelect && singleFileCount != null
          ? `${singleFileCount} changed file${singleFileCount === 1 ? '' : 's'}`
          : null,
      ];
  return (
    <ListStatusBar
      summary={summary}
      filters={
        <ActiveFilters count={activeFilterCount} shownCount={sortedPrsCount} onClear={onClearAllFilters} />
      }
      done={{ count: archivedKeys.size, active: showDone, onToggle: onToggleShowDone }}
      snoozed={{ count: snoozedCount, active: showSnoozed, onToggle: onToggleShowSnoozed }}
      onColumns={onOpenColumnMenu}
      helpSection="reviews"
    >
      {!showSnoozed && isMultiSelect ? (
        <>
          {changesLoading ? (
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
            <span className="text-foreground">{selectedPrs.length} PRs selected, no overlapping files</span>
          )}
          <button
            type="button"
            onClick={(event) => onSnoozeSelected(event.currentTarget.getBoundingClientRect())}
            className="rounded border border-border bg-card px-2 py-0.5 text-xs hover:bg-secondary"
          >
            Snooze selected
          </button>
        </>
      ) : null}
    </ListStatusBar>
  );
}
