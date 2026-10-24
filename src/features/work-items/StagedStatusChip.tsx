import { Loader2, X } from 'lucide-react';
import type { StagedChanges, StagedEntry } from './workItemChanges';

export function StagedStatusChip({
  stagedEntries,
  applying,
  onApply,
  onDiscard,
  undoState,
  onUndo,
  applyError,
}: {
  stagedEntries: StagedEntry[];
  applying: boolean;
  onApply: () => void;
  onDiscard: () => void;
  undoState: { changes: StagedChanges; workItemId: number; count: number } | null;
  onUndo: () => void;
  applyError: string | null;
}) {
  return (
    <>
      {stagedEntries.length > 0 ? (
        <span
          className="flex shrink-0 items-center gap-1 rounded-full border border-warning/30 bg-warning/10 py-0.5 pl-2 pr-0.5 text-2xs"
          title={stagedEntries
            .map((entry) => `${entry.label}: ${entry.from} → ${entry.to}`)
            .join("\n")}
        >
          <span className="font-medium text-warning">{stagedEntries.length} pending</span>
          <button
            type="button"
            onClick={onApply}
            disabled={applying}
            title="Apply (Ctrl+S)"
            className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
            Apply
          </button>
          <button
            type="button"
            aria-label="Discard pending changes"
            title="Discard (Esc)"
            onClick={onDiscard}
            disabled={applying}
            className="rounded-full p-0.5 text-warning/70 hover:bg-warning/20 hover:text-warning disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </span>
      ) : null}
      {undoState && stagedEntries.length === 0 ? (
        <span className="flex shrink-0 items-center gap-1 rounded-full border border-success/30 bg-success/10 py-0.5 pl-2 pr-0.5 text-2xs">
          <span className="text-success">Applied {undoState.count}</span>
          <button
            type="button"
            onClick={onUndo}
            disabled={applying}
            title="Undo (U)"
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 hover:bg-secondary disabled:opacity-50"
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
            Undo
          </button>
        </span>
      ) : null}
      {applyError ? (
        <span
          className="max-w-[220px] shrink-0 truncate rounded border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-2xs text-destructive"
          title={applyError}
        >
          {applyError}
        </span>
      ) : null}
    </>
  );
}
