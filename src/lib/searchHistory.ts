/**
 * Recent / saved searches for the Search views' empty states. One localStorage
 * blob per scope (`azdodeck:<scope>:searchHistory`); `filters` is opaque to this
 * module so each view stores whatever it needs to re-run the search.
 */
import { useCallback, useState } from "react";
import { readStoredJson, writeStoredJson } from "@/lib/storage";

export const RECENT_SEARCHES_MAX = 5;
export const SAVED_SEARCHES_MAX = 20;

export type SearchHistoryEntry<F> = {
  id: string;
  organizationId?: string;
  query: string;
  filters: F;
  /** Short human summary of the filters, e.g. "Active · 2 repos". */
  summary: string;
  at: string;
};

export type SearchHistory<F> = { recent: SearchHistoryEntry<F>[]; saved: SearchHistoryEntry<F>[] };
export type SearchHistoryKind = keyof SearchHistory<unknown>;

const storageKeyFor = (scope: string) => `azdodeck:${scope}:searchHistory`;

function parseEntries<F>(raw: unknown): SearchHistoryEntry<F>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is SearchHistoryEntry<F> =>
      !!e && typeof e === "object" && typeof e.id === "string" && typeof e.query === "string" && typeof e.at === "string",
  );
}

export function loadSearchHistory<F>(scope: string): SearchHistory<F> {
  return readStoredJson<SearchHistory<F>>(
    storageKeyFor(scope),
    (raw) => {
      if (!raw || typeof raw !== "object") return undefined;
      const r = raw as Record<string, unknown>;
      return { recent: parseEntries<F>(r.recent), saved: parseEntries<F>(r.saved) };
    },
    { recent: [], saved: [] },
  );
}

/** Identity of a search: same text, org and filters means the same entry. */
export function searchEntryId(organizationId: string | undefined, query: string, filters: unknown): string {
  return JSON.stringify([organizationId ?? "", query.trim(), filters]);
}

export function useSearchHistory<F>(scope: string) {
  const [history, setHistory] = useState<SearchHistory<F>>(() => loadSearchHistory<F>(scope));

  const update = useCallback(
    (fn: (current: SearchHistory<F>) => SearchHistory<F>) => {
      const next = fn(loadSearchHistory<F>(scope));
      writeStoredJson(storageKeyFor(scope), next);
      setHistory(next);
    },
    [scope],
  );

  /** Records an executed search at the top of "recent" (deduped, capped). */
  const record = useCallback(
    (entry: Omit<SearchHistoryEntry<F>, "id" | "at">) => {
      const id = searchEntryId(entry.organizationId, entry.query, entry.filters);
      const next = { ...entry, query: entry.query.trim(), id, at: new Date().toISOString() };
      update((h) => ({ ...h, recent: [next, ...h.recent.filter((e) => e.id !== id)].slice(0, RECENT_SEARCHES_MAX) }));
    },
    [update],
  );

  /** Pins a recent search into "saved". */
  const pin = useCallback(
    (id: string) =>
      update((h) => {
        const entry = h.recent.find((e) => e.id === id);
        if (!entry) return h;
        return { ...h, saved: [entry, ...h.saved.filter((e) => e.id !== id)].slice(0, SAVED_SEARCHES_MAX) };
      }),
    [update],
  );

  const remove = useCallback(
    (kind: SearchHistoryKind, id: string) => update((h) => ({ ...h, [kind]: h[kind].filter((e) => e.id !== id) })),
    [update],
  );

  return { history, record, pin, remove };
}
