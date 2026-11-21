import { SearchHistoryPanel, type SearchHistoryRow } from '@/components/SearchHistoryPanel';
import { formatRelativeDate } from '@/lib/utils';
import type { SearchHistoryEntry, useSearchHistory } from '@/lib/searchHistory';
import type { PrSearchFilters } from './prSearchHistoryHelpers';

const toRow = (e: SearchHistoryEntry<PrSearchFilters>, withTime: boolean): SearchHistoryRow => ({
  id: e.id,
  primary: e.query || "(all pull requests)",
  secondary: e.summary,
  time: withTime ? formatRelativeDate(e.at) : undefined,
});

/** Recent / saved PR searches shown in the list pane before any search has run. */
export function PrSearchHistory({
  organizationId,
  history: { history, pin, remove },
  onRun,
}: {
  organizationId: string | undefined;
  history: ReturnType<typeof useSearchHistory<PrSearchFilters>>;
  onRun: (query: string, filters: PrSearchFilters) => void;
}) {
  const sameOrg = (e: SearchHistoryEntry<PrSearchFilters>) => (e.organizationId ?? "") === (organizationId ?? "");
  const recent = history.recent.filter(sameOrg);
  const saved = history.saved.filter(sameOrg);
  return (
    <SearchHistoryPanel
      emptyMessage="Run a search to load pull requests."
      sections={[
        { kind: "recent", title: "Recent searches", rows: recent.map((e) => toRow(e, true)) },
        { kind: "saved", title: "Saved", rows: saved.map((e) => toRow(e, false)) },
      ]}
      onRun={(kind, id) => {
        const entry = (kind === "saved" ? saved : recent).find((e) => e.id === id);
        if (entry) onRun(entry.query, entry.filters);
      }}
      onPin={pin}
      onRemove={remove}
    />
  );
}
