import type { RefObject } from 'react';
import type { Organization } from '@/lib/azdoCommands';
import { FilterAutocomplete } from '@/components/FilterAutocomplete';

type ReviewFilterBarProps = {
  organizations: Organization[];
  organizationId: string;
  onOrganizationChange: (id: string) => void;
  textFilter: string;
  onTextFilterChange: (value: string) => void;
  filterInputRef: RefObject<HTMLInputElement | null>;
  showDrafts: boolean;
  onShowDraftsChange: (checked: boolean) => void;
  filterSuggestionPool: string[];
};

export function ReviewFilterBar({
  organizations,
  organizationId,
  onOrganizationChange,
  textFilter,
  onTextFilterChange,
  filterInputRef,
  showDrafts,
  onShowDraftsChange,
  filterSuggestionPool,
}: ReviewFilterBarProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
      {organizations.length > 1 && (
        <select
          value={organizationId}
          onChange={(e) => onOrganizationChange(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
          aria-label="Organization"
        >
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      <FilterAutocomplete
        value={textFilter}
        onChange={onTextFilterChange}
        onClear={() => onTextFilterChange('')}
        placeholder="Filter by repo, title, author…"
        suggestionPool={filterSuggestionPool}
        inputRef={filterInputRef}
      />
      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={showDrafts}
          onChange={(e) => onShowDraftsChange(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-input"
        />
        Show Drafts
      </label>
    </div>
  );
}
