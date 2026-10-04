import { Copy, Link2 } from "lucide-react";
import type { LineRange } from "./codeBrowseShared";

export function isSelected(range: LineRange | null, lineNumber: number): boolean {
  return !!range && lineNumber >= range.start && lineNumber <= range.end;
}

// A line number that selects its line (Shift+click extends the range). Rendered
// as a button so it is reachable and operable from the keyboard; the roving
// focus is handled by the container (see useLineSelection).
export function LineNumberButton({
  lineNumber,
  selected,
  onSelect,
  className = "",
  style,
}: {
  lineNumber: number;
  selected: boolean;
  onSelect: (lineNumber: number, extend: boolean) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      data-line-item
      tabIndex={-1}
      aria-label={`Line ${lineNumber}`}
      aria-pressed={selected}
      onClick={(event) => onSelect(lineNumber, event.shiftKey)}
      style={style}
      className={`block select-none px-2 text-right tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${
        selected
          ? "bg-amber-200/40 text-foreground dark:bg-amber-400/20"
          : "text-muted-foreground hover:text-foreground"
      } ${className}`}
    >
      {lineNumber}
    </button>
  );
}

// Shows the selected range with actions to copy a permalink or the raw lines.
export function LineSelectionBar({
  range,
  onCopyLink,
  onCopyLines,
}: {
  range: LineRange | null;
  onCopyLink: () => void;
  onCopyLines: () => void;
}) {
  if (!range) return null;
  return (
    <>
      <span>
        {range.start === range.end ? `Line ${range.start}` : `Lines ${range.start}-${range.end}`}
      </span>
      <button
        type="button"
        onClick={onCopyLink}
        className="flex items-center gap-1 hover:text-foreground"
      >
        <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Copy link
      </button>
      <button
        type="button"
        onClick={onCopyLines}
        className="flex items-center gap-1 hover:text-foreground"
      >
        <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy lines
      </button>
    </>
  );
}
