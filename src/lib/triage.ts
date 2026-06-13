// Octobox-style local "done" state for inbox-like grids. Archived rows are
// keyed per scope (view + organization) and remember a snapshot of the row;
// when the row changes upstream the entry no longer matches and the row
// returns to the inbox automatically.

type TriageEntry = { snapshot: string; archivedAt: string };
type TriageStore = Record<string, TriageEntry>;

const STORAGE_PREFIX = "azdodeck:triage:";

function loadTriageStore(scope: string): TriageStore {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(`${STORAGE_PREFIX}${scope}`) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const store: TriageStore = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (
        value &&
        typeof value === "object" &&
        typeof (value as TriageEntry).snapshot === "string" &&
        typeof (value as TriageEntry).archivedAt === "string"
      ) {
        store[key] = value as TriageEntry;
      }
    }
    return store;
  } catch {
    return {};
  }
}

function storeTriageStore(scope: string, store: TriageStore): void {
  window.localStorage.setItem(`${STORAGE_PREFIX}${scope}`, JSON.stringify(store));
}

export function toggleTriageArchived(scope: string, key: string, snapshot: string): void {
  const store = loadTriageStore(scope);
  if (store[key]) {
    delete store[key];
  } else {
    store[key] = { snapshot, archivedAt: new Date().toISOString() };
  }
  storeTriageStore(scope, store);
}

// Returns the keys that are still archived for the given rows, dropping
// entries whose row changed (snapshot mismatch) so they resurface.
export function activeArchivedKeys(
  scope: string,
  currentSnapshots: ReadonlyMap<string, string>,
): Set<string> {
  const store = loadTriageStore(scope);
  const archived = new Set<string>();
  let dirty = false;
  for (const [key, entry] of Object.entries(store)) {
    const current = currentSnapshots.get(key);
    if (current === undefined) {
      // Row not in the current data set (e.g. PR completed): keep the entry
      // so the row stays done if it ever reappears unchanged.
      continue;
    }
    if (current === entry.snapshot) {
      archived.add(key);
    } else {
      delete store[key];
      dirty = true;
    }
  }
  if (dirty) storeTriageStore(scope, store);
  return archived;
}
