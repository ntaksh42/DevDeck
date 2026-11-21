import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkItemSummary } from '@/lib/azdoCommands';
import { useWorkItemViewQuery } from './useWorkItemViewQuery';

const commands = vi.hoisted(() => ({
  getCachedWorkItemQuery: vi.fn(),
  runWorkItemQuery: vi.fn(),
}));
vi.mock('@/lib/azdoCommands', () => commands);

function row(id: number, title: string): WorkItemSummary {
  return {
    organizationId: 'org',
    projectId: 'p1',
    projectName: 'P',
    id,
    title,
    workItemType: 'Bug',
    state: 'New',
    assignedTo: null,
    changedDate: null,
    webUrl: null,
    tags: null,
  } as WorkItemSummary;
}

const view = { id: 'v1', name: 'Bugs', projectId: 'p1', wiql: 'SELECT [System.Id] FROM WorkItems' };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    () => useWorkItemViewQuery({ organizationId: 'org', view, projectId: 'p1', extraColumns: [] }),
    { wrapper },
  );
}

describe('useWorkItemViewQuery', () => {
  beforeEach(() => {
    commands.getCachedWorkItemQuery.mockReset();
    commands.runWorkItemQuery.mockReset();
  });

  it('shows the persisted rows and their fetch time until the query answers', async () => {
    const cachedRows = [row(1, 'old')];
    commands.getCachedWorkItemQuery.mockResolvedValue({
      items: cachedRows,
      fetchedAt: '2026-11-20T10:00:00.000Z',
    });
    let answer: (rows: WorkItemSummary[]) => void = () => {};
    commands.runWorkItemQuery.mockReturnValue(new Promise((resolve) => { answer = resolve; }));

    const { result } = setup();
    await waitFor(() => expect(result.current.query.data).toEqual(cachedRows));
    expect(result.current.query.isFetching).toBe(true);
    expect(result.current.dataUpdatedAt).toBe(Date.parse('2026-11-20T10:00:00.000Z'));

    const fresh = [row(1, 'new'), row(2, 'added')];
    answer(fresh);
    await waitFor(() => expect(result.current.query.data).toEqual(fresh));
    expect(result.current.query.isPlaceholderData).toBe(false);
    expect(result.current.dataUpdatedAt).toBeGreaterThan(Date.parse('2026-11-20T10:00:00.000Z'));
  });

  it('waits for the query when nothing was persisted', async () => {
    commands.getCachedWorkItemQuery.mockResolvedValue(null);
    commands.runWorkItemQuery.mockResolvedValue([row(3, 'only')]);

    const { result } = setup();
    expect(result.current.query.data).toBeUndefined();
    await waitFor(() => expect(result.current.query.data).toEqual([row(3, 'only')]));
  });
});
