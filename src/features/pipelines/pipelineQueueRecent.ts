// Remembers, per pipeline, the branch and non-secret variable values last used
// to queue a run, so queueing the same pipeline again starts from them. Free-
// text parameters are deliberately not stored (they may hold secrets), and
// secret variables never reach this module.
const STORAGE_KEY = "azdodeck:pipelines:queueRecent:v1";
const MAX_ENTRIES = 50;

export type QueueRecent = { branch: string; variables: Record<string, string> };

type Store = Record<string, QueueRecent>;

function recentKey(organizationId: string, projectId: string, definitionId: number): string {
  return `${organizationId}|${projectId}|${definitionId}`;
}

function readStore(): Store {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

export function loadQueueRecent(
  organizationId: string,
  projectId: string,
  definitionId: number,
): QueueRecent | null {
  const entry = readStore()[recentKey(organizationId, projectId, definitionId)];
  if (!entry || typeof entry.branch !== "string") return null;
  return { branch: entry.branch, variables: entry.variables && typeof entry.variables === "object" ? entry.variables : {} };
}

export function saveQueueRecent(
  organizationId: string,
  projectId: string,
  definitionId: number,
  recent: QueueRecent,
) {
  try {
    const store = readStore();
    const key = recentKey(organizationId, projectId, definitionId);
    delete store[key];
    // Re-insert last so the oldest entries (first keys) are the ones trimmed.
    const entries = Object.entries({ ...store, [key]: recent }).slice(-MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Storage can be unavailable; the values simply won't be remembered.
  }
}
