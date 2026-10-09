import type { RefObject } from 'react';
import { DockFilterBar, type DockFilterChip } from '@/components/DockFilterBar';
import { FilterAutocomplete } from '@/components/FilterAutocomplete';
import { DraftsCheckbox } from './DraftsCheckbox';

type ReviewFilterBarProps = {
  textFilter: string;
  onTextFilterChange: (value: string) => void;
  filterInputRef: RefObject<HTMLInputElement | null>;
  showDrafts: boolean;
  onShowDraftsChange: (checked: boolean) => void;
  /** Drafts in the unfiltered list, shown next to the Show Drafts toggle. */
  draftCount?: number;
  filterSuggestionPool: string[];
  open: boolean;
  onOpen: () => void;
  /** `returnFocus` is false when focus already moved elsewhere (blur). */
  onClose: (returnFocus: boolean) => void;
};

/** The Reviews filter, folded into the grid's dock tab strip. */
export function ReviewFilterBar({
  textFilter,
  onTextFilterChange,
  filterInputRef,
  showDrafts,
  onShowDraftsChange,
  draftCount = 0,
  filterSuggestionPool,
  open,
  onOpen,
  onClose,
}: ReviewFilterBarProps) {
  const chips: DockFilterChip[] = [];
  if (textFilter) chips.push({ label: `“${textFilter}”`, onEdit: onOpen, onClear: () => onTextFilterChange('') });

  return (
    <div className="flex h-full min-w-0 items-center">
      <DockFilterBar
        label="Filter reviews"
        open={open}
        onOpen={onOpen}
        onClose={onClose}
        inputRef={filterInputRef}
        hasValue={!!textFilter}
        chips={chips}
      >
        <div className="w-56">
          <FilterAutocomplete
            compact
            value={textFilter}
            onChange={onTextFilterChange}
            onClear={() => onTextFilterChange('')}
            placeholder="Filter by repo, title, author…"
            suggestionPool={filterSuggestionPool}
            inputRef={filterInputRef}
          />
        </div>
      </DockFilterBar>
      <DraftsCheckbox
        checked={showDrafts}
        onChange={onShowDraftsChange}
        draftCount={draftCount}
        title="Show draft pull requests (D)"
      />
    </div>
  );
}
