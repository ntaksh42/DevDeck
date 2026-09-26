import type { RefObject } from 'react';
import { DockFilterBar, type DockFilterChip } from '@/components/DockFilterBar';
import { FilterAutocomplete } from '@/components/FilterAutocomplete';

type ReviewFilterBarProps = {
  textFilter: string;
  onTextFilterChange: (value: string) => void;
  filterInputRef: RefObject<HTMLInputElement | null>;
  showDrafts: boolean;
  onShowDraftsChange: (checked: boolean) => void;
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
  filterSuggestionPool,
  open,
  onOpen,
  onClose,
}: ReviewFilterBarProps) {
  const chips: DockFilterChip[] = [];
  if (textFilter) chips.push({ label: `“${textFilter}”`, onEdit: onOpen, onClear: () => onTextFilterChange('') });
  if (showDrafts) chips.push({ label: 'Drafts shown', onClear: () => onShowDraftsChange(false) });

  return (
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
      <label className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={showDrafts}
          onChange={(e) => onShowDraftsChange(e.target.checked)}
          className="h-3 w-3 rounded border-input"
        />
        Show Drafts
      </label>
    </DockFilterBar>
  );
}
