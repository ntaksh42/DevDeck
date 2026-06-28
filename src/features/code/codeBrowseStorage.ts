import { readStoredJson, storageKey, writeStoredJson } from "@/lib/storage";

// Persisted code-browser preferences: favorite repositories and the last
// repository/branch the user had open, so the view reopens where they left off.

const FAVORITES_KEY = storageKey("azdodeck:codeBrowse:favorites", 1);
const LAST_KEY = storageKey("azdodeck:codeBrowse:last", 1);

// Favorites are keyed by repository id, scoped per organization so different
// orgs keep independent stars.
type FavoritesMap = Record<string, string[]>;

function readFavoritesMap(): FavoritesMap {
  return readStoredJson<FavoritesMap>(
    FAVORITES_KEY,
    (raw) => (raw && typeof raw === "object" ? (raw as FavoritesMap) : undefined),
    {},
  );
}

export function getFavoriteRepositoryIds(organizationId: string): string[] {
  return readFavoritesMap()[organizationId] ?? [];
}

export function toggleFavoriteRepository(organizationId: string, repositoryId: string): string[] {
  const map = readFavoritesMap();
  const current = new Set(map[organizationId] ?? []);
  if (current.has(repositoryId)) current.delete(repositoryId);
  else current.add(repositoryId);
  const next = [...current];
  writeStoredJson(FAVORITES_KEY, { ...map, [organizationId]: next });
  return next;
}

type LastSelection = { organizationId: string; repositoryId: string; branch: string };

export function getLastSelection(organizationId: string): { repositoryId: string; branch: string } | null {
  const stored = readStoredJson<LastSelection | null>(
    LAST_KEY,
    (raw) => {
      if (!raw || typeof raw !== "object") return undefined;
      const value = raw as Partial<LastSelection>;
      if (typeof value.organizationId !== "string" || typeof value.repositoryId !== "string") {
        return undefined;
      }
      return {
        organizationId: value.organizationId,
        repositoryId: value.repositoryId,
        branch: typeof value.branch === "string" ? value.branch : "",
      };
    },
    null,
  );
  if (!stored || stored.organizationId !== organizationId) return null;
  return { repositoryId: stored.repositoryId, branch: stored.branch };
}

export function setLastSelection(
  organizationId: string,
  repositoryId: string,
  branch: string,
): void {
  writeStoredJson(LAST_KEY, { organizationId, repositoryId, branch });
}
