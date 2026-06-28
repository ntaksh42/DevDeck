import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  LAYOUT_STORAGE_PREFIX,
  clearLayoutStorage,
} from "@/lib/layoutReset";

export function DataCacheSettings() {
  const queryClient = useQueryClient();
  const [revision, setRevision] = useState(0);
  const queryCount = queryClient.getQueryCache().getAll().length;
  const azdodeckStorageEntries = Object.keys(window.localStorage).filter((key) =>
    key.startsWith("azdodeck:"),
  );
  const layoutStorageEntries = azdodeckStorageEntries.filter((key) =>
    key.startsWith(LAYOUT_STORAGE_PREFIX),
  );
  const localStorageBytes = azdodeckStorageEntries.reduce((total, key) => {
    const value = window.localStorage.getItem(key) ?? "";
    return total + key.length + value.length;
  }, 0);

  function refreshStats() {
    setRevision((value) => value + 1);
  }

  function clearDataCache() {
    queryClient.clear();
    refreshStats();
  }

  function resetLayoutCache() {
    clearLayoutStorage();
    refreshStats();
    // Widths live in component state across the app; reload so every sidebar,
    // preview, and grid re-initializes from its default width.
    window.location.reload();
  }

  return (
    <div className="rounded-md border border-border bg-card" data-cache-revision={revision}>
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-base font-semibold">Data cache</h2>
        <p className="text-sm text-muted-foreground">
          Clear cached server responses without removing organizations or saved WIQL views.
        </p>
      </div>
      <div className="grid gap-3 p-3 md:grid-cols-[1fr_auto] md:items-center">
        <div className="grid gap-1 text-sm">
          <p>
            <span className="text-muted-foreground">Query cache:</span>{" "}
            <span className="font-medium">{queryCount} entries</span>
          </p>
          <p>
            <span className="text-muted-foreground">Local UI storage:</span>{" "}
            <span className="font-medium">{formatBytes(localStorageBytes)}</span>
            <span className="text-muted-foreground"> across {azdodeckStorageEntries.length} keys</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={clearDataCache}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium hover:bg-secondary"
          >
            Clear data cache
          </button>
          <button
            type="button"
            onClick={resetLayoutCache}
            disabled={layoutStorageEntries.length === 0}
            title="Restore sidebar, preview, and grid column widths to their defaults. Saved Work Item Views and credentials are kept."
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reset layout widths
          </button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
