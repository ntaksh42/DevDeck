import { Fragment, type ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";
import { requestHelp, type HelpSection } from "@/lib/helpEvents";
import { focusPrimaryGrid } from "@/lib/utils";

const BUTTON = "rounded border px-2 py-0.5 text-xs";
const IDLE = "border-border bg-card hover:bg-secondary";
const PRESSED = "border-primary bg-primary/10 text-primary";

/** `1 item` / `4 items`; `qualifier` gives e.g. `2 snoozed items`. */
export function itemCount(count: number, qualifier = ""): string {
  return `${count} ${qualifier ? qualifier + " " : ""}item${count === 1 ? "" : "s"}`;
}

type StateToggle = { count: number; active: boolean; onToggle: () => void };

/**
 * The status bar under a docked list pane. Left: `N items` plus view-specific
 * extras joined with " · ". Right, always in this order and omitted when a view
 * has none of it: filters, Done, Snoozed, Stale, Columns, then `?` (opens Help
 * at the view's section).
 */
export function ListStatusBar({
  summary,
  children,
  filters,
  done,
  snoozed,
  stale,
  onColumns,
  helpSection,
}: {
  /** Parts of the left summary; falsy entries are skipped. */
  summary: ReactNode[];
  /** Extra left-side controls (e.g. conflict-risk or "Snooze selected" buttons). */
  children?: ReactNode;
  filters?: ReactNode;
  done?: StateToggle;
  snoozed?: StateToggle;
  stale?: StateToggle & { thresholdDays: number };
  onColumns?: (rect: DOMRect) => void;
  helpSection?: HelpSection;
}) {
  const parts = summary.filter((part) => part !== null && part !== undefined && part !== false && part !== "");
  return (
    <div className="mt-auto flex shrink-0 items-center justify-between gap-2 border-t border-border px-2 py-1 text-xs text-muted-foreground">
      <span className="flex min-w-0 items-center gap-3">
        <span className="-mx-0.5 -my-0.5 min-w-0 truncate px-0.5 py-0.5">
          {parts.map((part, index) => (
            <Fragment key={index}>
              {index > 0 ? " · " : null}
              {part}
            </Fragment>
          ))}
        </span>
        {children}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {filters}
        {done ? (
          <button
            type="button"
            aria-pressed={done.active}
            title="Toggle done view (E marks the selected row done)"
            onClick={done.onToggle}
            className={`${BUTTON} ${done.active ? PRESSED : IDLE}`}
          >
            Done {done.count}
          </button>
        ) : null}
        {snoozed ? (
          <button
            type="button"
            aria-pressed={snoozed.active}
            title="Toggle snoozed view (Z snoozes the selected row)"
            onClick={snoozed.onToggle}
            className={`${BUTTON} ${snoozed.active ? PRESSED : IDLE}`}
          >
            Snoozed {snoozed.count}
          </button>
        ) : null}
        {stale ? (
          <button
            type="button"
            aria-pressed={stale.active}
            title={`Show only stale items (no change in ${stale.thresholdDays}+ days)`}
            onClick={stale.onToggle}
            className={`inline-flex items-center gap-1 ${BUTTON} ${
              stale.active
                ? "border-orange-500 bg-orange-500/10 text-orange-700 dark:text-orange-300"
                : IDLE
            }`}
          >
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            Stale {stale.count}
          </button>
        ) : null}
        {onColumns ? (
          <button
            type="button"
            onClick={(event) => onColumns(event.currentTarget.getBoundingClientRect())}
            className={`${BUTTON} ${IDLE}`}
          >
            Columns
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Show keyboard shortcuts for this view"
          title="Keyboard shortcuts (F1)"
          onClick={() => {
            // Help returns focus to whatever opened it; hand it the grid so
            // keyboard navigation resumes there instead of on this button.
            focusPrimaryGrid();
            requestHelp(helpSection);
          }}
          className={`${BUTTON} font-medium ${IDLE}`}
        >
          ?
        </button>
      </span>
    </div>
  );
}

/**
 * Tab-band chip shown while a list is switched to its Done or Snoozed view.
 * Its X (or Escape in the list) returns to the open list.
 */
export function ListStateChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span
      title={`Showing ${label.toLowerCase()} items (Esc to go back)`}
      className="inline-flex h-4 shrink-0 items-center rounded-full bg-primary/10 text-[11px] text-link"
    >
      <span className="pl-2 pr-1">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Back to open list (leave ${label.toLowerCase()} view)`}
        className="pr-1.5 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  );
}
