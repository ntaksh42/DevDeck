import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectQueryOption } from '@/lib/azdoCommands';
import { filterProjectQueries, ProjectQueryPicker } from './ProjectQueryPicker';

const queries: ProjectQueryOption[] = [
  { id: 'a', name: '担当中のタスク', folderPath: 'Shared Queries/チームA', isPublic: true, wiql: 'x' },
  { id: 'b', name: 'Active Bugs', folderPath: 'Shared Queries', isPublic: true, wiql: 'y' },
  { id: 'c', name: 'Sprint 1 review', folderPath: 'Shared Queries/Sprint', isPublic: true, wiql: 'z' },
];

function setup(onSelect = vi.fn()) {
  render(
    <ProjectQueryPicker queries={queries} hasProject loading={false} error={null} onSelect={onSelect} />,
  );
  return { onSelect, input: screen.getByRole('combobox') };
}

describe('filterProjectQueries', () => {
  it('matches Japanese names and folder paths, case-insensitively, with AND terms', () => {
    expect(filterProjectQueries(queries, 'タスク').map((q) => q.id)).toEqual(['a']);
    expect(filterProjectQueries(queries, 'チームa').map((q) => q.id)).toEqual(['a']);
    expect(filterProjectQueries(queries, 'sprint review').map((q) => q.id)).toEqual(['c']);
    expect(filterProjectQueries(queries, '')).toHaveLength(3);
  });
});

describe('ProjectQueryPicker', () => {
  afterEach(cleanup);

  it('filters the list as the user types and selects with Enter', () => {
    const { onSelect, input } = setup();
    fireEvent.change(input, { target: { value: 'タスク' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('moves with arrow keys and ignores Enter during IME composition', () => {
    const { onSelect, input } = setup();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('clears the filter on the first Escape only', () => {
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <ProjectQueryPicker queries={queries} hasProject loading={false} error={null} onSelect={vi.fn()} />
      </div>,
    );
    const input = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'bug' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
    expect(outer).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(outer).toHaveBeenCalledTimes(1);
  });
});
