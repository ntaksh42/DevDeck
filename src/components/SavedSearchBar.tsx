import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  APPLY_SEARCH_PRESET_EVENT,
  SEARCH_PRESETS_CHANGED_EVENT,
  consumePendingSearchPreset,
  loadSearchPresets,
  newSearchPresetId,
  saveSearchPresets,
  type SearchPreset,
  type SearchPresetKind,
  type SearchPresetPayload,
} from "@/lib/searchPresets";

// Subscribes a search view to cross-view apply requests (e.g. from the command
// palette). Consumes a pending preset on mount, and listens for later requests
// while the view stays mounted.
export function useApplySearchPreset<P extends SearchPresetPayload>(
  kind: SearchPresetKind,
  onApply: (payload: P) => void,
) {
  useEffect(() => {
    const pending = consumePendingSearchPreset<P>(kind);
    if (pending) onApply(pending);
    function handle(event: Event) {
      if ((event as CustomEvent<{ kind: SearchPresetKind }>).detail?.kind !== kind) return;
      const payload = consumePendingSearchPreset<P>(kind);
      if (payload) onApply(payload);
    }
    window.addEventListener(APPLY_SEARCH_PRESET_EVENT, handle);
    return () => window.removeEventListener(APPLY_SEARCH_PRESET_EVENT, handle);
    // onApply is recreated each render; callers pass a stable closure via the
    // latest state, so we intentionally only re-bind on kind changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
}

// Compact "Saved searches" bar: save the current criteria under a name, then
// re-apply or delete saved entries. Used by every search view.
export function SavedSearchBar<P extends SearchPresetPayload>({
  kind,
  currentPayload,
  onApply,
}: {
  kind: SearchPresetKind;
  currentPayload: P;
  onApply: (payload: P) => void;
}) {
  const [presets, setPresets] = useState<SearchPreset<P>[]>(() =>
    loadSearchPresets<P>(kind),
  );

  // Stay in sync when another view (or this one) writes saved searches.
  useEffect(() => {
    function refresh() {
      setPresets(loadSearchPresets<P>(kind));
    }
    window.addEventListener(SEARCH_PRESETS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(SEARCH_PRESETS_CHANGED_EVENT, refresh);
  }, [kind]);

  function persist(next: SearchPreset<P>[]) {
    setPresets(next);
    saveSearchPresets(kind, next);
  }

  function saveCurrent() {
    const name = window.prompt("Save current search as:")?.trim();
    if (!name) return;
    persist([
      ...presets.filter((preset) => preset.name !== name),
      { id: newSearchPresetId(), name, payload: currentPayload },
    ]);
  }

  function remove(id: string) {
    persist(presets.filter((preset) => preset.id !== id));
  }

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-1.5"
      role="group"
      aria-label="Saved searches"
    >
      <span className="text-xs font-medium text-muted-foreground">Saved</span>
      {presets.length === 0 ? (
        <span className="text-xs text-muted-foreground/70">
          Save the current filters to reuse them later.
        </span>
      ) : (
        presets.map((preset) => (
          <span
            key={preset.id}
            className="inline-flex h-7 items-center overflow-hidden rounded-md border border-border"
          >
            <button
              type="button"
              onClick={() => onApply(preset.payload)}
              title={`Apply saved search "${preset.name}"`}
              className="h-full max-w-[180px] truncate px-2 text-xs font-medium text-foreground hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ring"
            >
              {preset.name}
            </button>
            <button
              type="button"
              onClick={() => remove(preset.id)}
              aria-label={`Delete saved search ${preset.name}`}
              title="Delete saved search"
              className="flex h-full w-6 items-center justify-center border-l border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ring"
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ))
      )}
      <button
        type="button"
        onClick={saveCurrent}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Save search
      </button>
    </div>
  );
}
