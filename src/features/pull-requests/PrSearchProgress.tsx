import type { PrSearchSortBy } from "./PrSearchTypes";
import { NativeSelect } from "@/components/SearchBar";
import { PR_SEARCH_SORT_OPTIONS } from "./PrSearchTypes";
import { useLayoutEffect, useRef } from "react";
import { focusPrimaryGrid } from "@/lib/utils";

export type PrSearchProgressState = {
  progressive: boolean;
  scannedCount: number;
  complete: boolean;
  hasMore: boolean;
  retryAvailable: boolean;
  dirty: boolean;
  stopping: boolean;
  onContinue: () => void;
  onRetry: () => void;
  onStop: () => void;
};

export function PrSearchProgressControls({ progress, loading }: { progress?: PrSearchProgressState; loading: boolean }) {
  const owner = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (owner.current && !owner.current.isConnected) {
      owner.current = null;
      if (document.activeElement !== document.body) return;
      if (!focusPrimaryGrid()) document.querySelector<HTMLElement>('[data-grid-focus-fallback="true"]')?.focus();
    }
  }, [loading, progress?.hasMore, progress?.retryAvailable]);
  const activate = (element: HTMLButtonElement, action: () => void) => {
    if (document.activeElement === element) owner.current = element;
    action();
  };
  if (!progress?.progressive) return null;
  const button = "shrink-0 rounded border border-border px-2 py-0.5 text-xs text-link hover:bg-secondary disabled:opacity-50";
  return <>
    {loading ? <button type="button" onClick={(event) => { if (!progress.stopping) activate(event.currentTarget, progress.onStop); }} aria-disabled={progress.stopping} className={button}>{progress.stopping ? "Stopping…" : "Stop"}</button>
      : progress.hasMore ? <button type="button" onClick={(event) => activate(event.currentTarget, progress.onContinue)} disabled={progress.dirty} className={button}>Search more</button> : null}
    {progress.retryAvailable && !loading ? <button type="button" onClick={(event) => activate(event.currentTarget, progress.onRetry)} disabled={progress.dirty} className={button}>Retry failed scopes</button> : null}
  </>;
}

export function PrSearchSort({ value, onChange }: { value: PrSearchSortBy; onChange: (value: PrSearchSortBy) => void }) {
  return <label className="inline-flex items-center gap-1 text-2xs text-muted-foreground" title="Sorts the results found so far. Unsearched PRs may appear later.">Sort
    <NativeSelect compact value={value} aria-label="Sort results" className="w-36" onChange={(event) => onChange(event.target.value as PrSearchSortBy)}>
      {PR_SEARCH_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </NativeSelect>
  </label>;
}
