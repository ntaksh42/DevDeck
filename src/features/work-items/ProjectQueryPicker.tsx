import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectQueryOption } from '@/lib/azdoCommands';

export function filterProjectQueries(
  queries: ProjectQueryOption[],
  filter: string,
): ProjectQueryOption[] {
  const terms = filter.toLowerCase().split(/[\s　]+/).filter(Boolean);
  if (terms.length === 0) return queries;
  return queries.filter((query) => {
    const haystack = `${query.folderPath}/${query.name}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

type ProjectQueryPickerProps = {
  queries: ProjectQueryOption[];
  hasProject: boolean;
  loading: boolean;
  error: string | null;
  onSelect: (queryId: string) => void;
};

export function ProjectQueryPicker({
  queries,
  hasProject,
  loading,
  error,
  onSelect,
}: ProjectQueryPickerProps) {
  const [filter, setFilter] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);
  const filtered = useMemo(() => filterProjectQueries(queries, filter), [queries, filter]);
  const disabled = !hasProject || loading;

  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  const placeholder = !hasProject
    ? 'Select a project first'
    : loading
      ? 'Loading queries…'
      : queries.length === 0
        ? 'No queries found'
        : `Filter ${queries.length} queries by folder or name…`;

  return (
    <div className="grid gap-1.5">
      <label
        className="text-xs font-medium text-muted-foreground"
        htmlFor="view-project-query-filter"
      >
        Import an Azure DevOps query
        <span className="ml-1 font-normal text-muted-foreground/70">
          (fetches the project's Shared/My Queries and fills Name + WIQL)
        </span>
      </label>
      <input
        id="view-project-query-filter"
        role="combobox"
        aria-expanded={!disabled && queries.length > 0}
        aria-controls="view-project-query-list"
        aria-autocomplete="list"
        aria-activedescendant={
          filtered[activeIndex] ? `view-project-query-${filtered[activeIndex].id}` : undefined
        }
        value={filter}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => {
          setFilter(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          // Enter while an IME is composing confirms the candidate, not the row.
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            if (filtered.length === 0) return;
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActiveIndex((index) => (index + step + filtered.length) % filtered.length);
          } else if (event.key === 'Enter') {
            // Never let Enter submit the surrounding form from this field.
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) return;
            event.stopPropagation();
            const query = filtered[activeIndex];
            if (query) onSelect(query.id);
          } else if (event.key === 'Escape' && filter) {
            // First Escape clears the filter; the next one closes the dialog.
            event.stopPropagation();
            setFilter('');
            setActiveIndex(0);
          }
        }}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
      />
      {!disabled && queries.length > 0 ? (
        <ul
          ref={listRef}
          id="view-project-query-list"
          role="listbox"
          aria-label="Azure DevOps queries"
          className="max-h-40 overflow-y-auto rounded-md border border-border bg-background text-sm"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-1.5 text-xs text-muted-foreground">No matching queries</li>
          ) : (
            filtered.map((query, index) => (
              <li
                key={query.id}
                id={`view-project-query-${query.id}`}
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => onSelect(query.id)}
                className={`flex cursor-pointer items-baseline gap-2 px-3 py-1 ${
                  index === activeIndex ? 'bg-secondary' : ''
                }`}
              >
                <span className="truncate">{query.name}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                  {query.folderPath}
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
