// Named, reusable saved searches for the PR / Commit / Work Item search views.
// Each view serializes its current filter criteria into a kind-specific payload
// that can be re-applied later, from the view itself or the command palette.

export type SearchPresetKind = "pr" | "commit" | "workItem";

export type PrSearchPayload = {
  organizationId?: string;
  query: string;
  projectId: string;
  repositoryId: string;
};

export type CommitSearchPayload = {
  organizationId?: string;
  query: string;
  author: string;
  branch: string;
  fromDate: string;
  toDate: string;
  projectId: string;
  repositoryId: string;
};

export type WorkItemSearchPayload = {
  organizationId?: string;
  query: string;
  state: string;
  workItemType: string;
  projectId: string;
};

export type SearchPresetPayload =
  | PrSearchPayload
  | CommitSearchPayload
  | WorkItemSearchPayload;

export type SearchPreset<P extends SearchPresetPayload = SearchPresetPayload> = {
  id: string;
  name: string;
  payload: P;
};

// Versioned per kind so a future payload-shape change can bump the suffix
// without colliding with old data (see issue #154).
const STORAGE_KEYS: Record<SearchPresetKind, string> = {
  pr: "azdodeck:savedSearches:pr:v1",
  commit: "azdodeck:savedSearches:commit:v1",
  workItem: "azdodeck:savedSearches:workItem:v1",
};

export const SEARCH_PRESETS_CHANGED_EVENT = "azdodeck:savedSearches:changed";
export const APPLY_SEARCH_PRESET_EVENT = "azdodeck:savedSearches:apply";

export const SEARCH_PRESET_KIND_LABELS: Record<SearchPresetKind, string> = {
  pr: "PR Search",
  commit: "Commit Search",
  workItem: "Work Item Search",
};

export function newSearchPresetId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadSearchPresets<P extends SearchPresetPayload>(
  kind: SearchPresetKind,
): SearchPreset<P>[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS[kind]);
    const parsed = JSON.parse(raw ?? "null");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is SearchPreset<P> =>
        !!entry &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        typeof entry.name === "string" &&
        !!entry.payload &&
        typeof entry.payload === "object",
    );
  } catch {
    return [];
  }
}

export function saveSearchPresets<P extends SearchPresetPayload>(
  kind: SearchPresetKind,
  presets: SearchPreset<P>[],
): void {
  window.localStorage.setItem(STORAGE_KEYS[kind], JSON.stringify(presets));
  window.dispatchEvent(new CustomEvent(SEARCH_PRESETS_CHANGED_EVENT));
}

// Cross-view apply: the command palette can request a preset be applied on a
// search view that may not be mounted yet, so the request is parked here and
// the target view consumes it on mount (or immediately via the event when it is
// already on screen).
type PendingApply = { kind: SearchPresetKind; payload: SearchPresetPayload };
let pendingApply: PendingApply | null = null;

export function requestApplySearchPreset(
  kind: SearchPresetKind,
  payload: SearchPresetPayload,
): void {
  pendingApply = { kind, payload };
  window.dispatchEvent(new CustomEvent(APPLY_SEARCH_PRESET_EVENT, { detail: { kind } }));
}

// Returns and clears a pending apply for the given kind, if any.
export function consumePendingSearchPreset<P extends SearchPresetPayload>(
  kind: SearchPresetKind,
): P | null {
  if (pendingApply?.kind !== kind) return null;
  const payload = pendingApply.payload as P;
  pendingApply = null;
  return payload;
}
