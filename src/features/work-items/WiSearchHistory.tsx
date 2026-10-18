import { SearchHistoryPanel, type SearchHistoryRow } from '@/components/SearchHistoryPanel';
import { formatRelativeDate } from '@/lib/utils';
import type { SearchHistoryEntry, useSearchHistory } from '@/lib/searchHistory';
import { loadRecentWorkItems, type RecentWorkItem } from '@/lib/recentItems';

/** Filters a Work Item search is re-run with. */
export type WiSearchFilters = { states: string[]; workItemTypes: string[]; projectIds: string[] };

export function summarizeWiSearchFilters(f: WiSearchFilters): string {
  const parts: string[] = [];
  if (f.states.length > 0) parts.push(f.states.join("/"));
  if (f.workItemTypes.length > 0) parts.push(f.workItemTypes.join("/"));
  if (f.projectIds.length > 0) parts.push(`${f.projectIds.length} project${f.projectIds.length === 1 ? "" : "s"}`);
  return parts.join(" · ") || "no filters";
}

const RECENTLY_VIEWED_MAX = 5;

const toRow = (e: SearchHistoryEntry<WiSearchFilters>, withTime: boolean): SearchHistoryRow => ({
  id: e.id,
  primary: e.query || "(all work items)",
  secondary: e.summary,
  time: withTime ? formatRelativeDate(e.at) : undefined,
});

/**
 * Recent searches and recently viewed work items (any view that opens one in the
 * preview records it via `recordRecentWorkItem`) shown before the first search.
 */
export function WiSearchHistory({
  organizationId,
  history: { history, pin, remove },
  onRun,
  onOpenItem,
}: {
  organizationId: string | undefined;
  history: ReturnType<typeof useSearchHistory<WiSearchFilters>>;
  onRun: (query: string, filters: WiSearchFilters) => void;
  onOpenItem: (item: RecentWorkItem) => void;
}) {
  const sameOrg = (e: SearchHistoryEntry<WiSearchFilters>) => (e.organizationId ?? "") === (organizationId ?? "");
  const recent = history.recent.filter(sameOrg);
  const saved = history.saved.filter(sameOrg);
  const viewed = loadRecentWorkItems()
    .filter((i) => i.organizationId === organizationId)
    .slice(0, RECENTLY_VIEWED_MAX);
  return (
    <SearchHistoryPanel
      emptyMessage="Run a search to load work items."
      sections={[
        { kind: "recent", title: "Recent searches", rows: recent.map((e) => toRow(e, true)) },
        { kind: "saved", title: "Saved", rows: saved.map((e) => toRow(e, false)) },
        {
          kind: "viewed",
          title: "Recently viewed",
          rows: viewed.map((i) => ({
            id: i.key,
            primary: `#${i.id} ${i.title}`,
            secondary: i.projectName,
            time: formatRelativeDate(i.viewedAt),
          })),
        },
      ]}
      onRun={(kind, id) => {
        if (kind === "viewed") {
          const item = viewed.find((i) => i.key === id);
          if (item) onOpenItem(item);
          return;
        }
        const entry = (kind === "saved" ? saved : recent).find((e) => e.id === id);
        if (entry) onRun(entry.query, entry.filters);
      }}
      onPin={pin}
      onRemove={remove}
    />
  );
}
