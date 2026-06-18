import { Fragment } from "react";
import { ShortcutHint } from "./ShortcutHint";

export type RowShortcut = { keys: string; label: string };

// Compact reminder of the main shortcuts available for the currently selected
// grid row. Mirrors the wording in HelpDialog so the two never disagree. Render
// it only when a row is actually selected so the keys shown are always live.
export function RowShortcutHints({ shortcuts }: { shortcuts: RowShortcut[] }) {
  return (
    <span className="flex items-center gap-2 overflow-hidden">
      {shortcuts.map((shortcut) => (
        <Fragment key={shortcut.keys}>
          <span className="flex shrink-0 items-center gap-1">
            <ShortcutHint>{shortcut.keys}</ShortcutHint>
            <span>{shortcut.label}</span>
          </span>
        </Fragment>
      ))}
    </span>
  );
}
