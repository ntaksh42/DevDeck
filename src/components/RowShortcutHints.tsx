// A compact, inline legend of the key shortcuts available for the selected
// grid row. Hidden on narrow widths so it never crowds the status bar.
export type RowShortcut = { keys: string; label: string };

export function RowShortcutHints({ hints }: { hints: RowShortcut[] }) {
  if (hints.length === 0) return null;
  return (
    <span
      className="hidden flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground lg:flex"
      aria-label="Shortcuts for the selected row"
    >
      {hints.map((hint) => (
        <span key={hint.keys} className="inline-flex items-center gap-1">
          <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px] leading-4 text-foreground">
            {hint.keys}
          </kbd>
          {hint.label}
        </span>
      ))}
    </span>
  );
}
