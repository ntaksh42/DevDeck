/**
 * Always-visible "Show Drafts" toggle for the PR grids' tab strip, placed next
 * to the folded filter so draft visibility is never hidden behind Ctrl+F.
 */
export function DraftsCheckbox({
  checked,
  onChange,
  draftCount,
  title,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Drafts in the unfiltered list; shown so hidden drafts are never silently missing. */
  draftCount: number;
  title?: string;
}) {
  return (
    <label title={title} className="flex shrink-0 cursor-pointer items-center gap-1 pr-1 text-[11px] text-muted-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3 w-3 rounded border-input"
      />
      Show Drafts{draftCount > 0 ? ` (${draftCount})` : ''}
    </label>
  );
}
