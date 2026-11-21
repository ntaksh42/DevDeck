import { forwardRef, type KeyboardEvent } from "react";
import { PreviewEmptyState } from "@/components/StateDisplay";
import type { HomeSuggestion } from "@/lib/azdoCommands";

const KIND_LABEL: Record<string, string> = { pr: "PR", wi: "WI", pipe: "CI" };
const KIND_CLASS: Record<string, string> = { pr: "text-link", wi: "text-success", pipe: "text-warning" };
/** Only the urgent rows carry a tag; `later` stays plain. */
const URGENCY_TAG: Record<string, { label: string; className: string }> = {
  now: { label: "Now", className: "bg-destructive/10 text-destructive" },
  today: { label: "Today", className: "bg-muted text-muted-foreground" },
};

/** How many suggestions show before "Show n more" (Orca's Up next shows 3). */
export const HOME_SUGGESTIONS_SHOWN = 3;

/**
 * The brief and the suggestions, as one listbox. The selected row shows the
 * whole reason; what Start asks appears in the chat input on Q.
 */
export const HomeSuggestionList = forwardRef<
  HTMLDivElement,
  {
    brief: string[];
    briefMeta: string;
    suggestions: HomeSuggestion[];
    selectedId: string | null;
    showAll: boolean;
    onShowAll: () => void;
    onSelect: (id: string) => void;
    /** Puts the selected suggestion's ask in the Orchestrator input (Q). */
    onStart: () => void;
    /** Dismisses the selected suggestion (E). */
    onDismiss: () => void;
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  }
>(function HomeSuggestionList({ brief, briefMeta, suggestions, selectedId, showAll, onShowAll, onSelect, onStart, onDismiss, onKeyDown }, ref) {
  const visible = showAll ? suggestions : suggestions.slice(0, HOME_SUGGESTIONS_SHOWN);
  const hidden = suggestions.length - visible.length;
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {brief.length ? (
        <section aria-label="Brief" className="border-b border-border px-3 py-1.5 text-sm">
          <h3 className="font-semibold" title={briefMeta}>
            Today
          </h3>
          <ul className="ml-4 list-disc text-[13px] leading-5">
            {brief.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <div
        ref={ref}
        data-primary-grid="true"
        role="listbox"
        aria-label="Suggestions"
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        {suggestions.length === 0 ? (
          <PreviewEmptyState
            message="Nothing needs you."
            hint="L to look again"
          />
        ) : null}
        {visible.map((suggestion) => {
          const selected = suggestion.id === selectedId;
          return (
            <div
              key={suggestion.id}
              role="option"
              aria-selected={selected}
              onClick={() => onSelect(suggestion.id)}
              className={`grid cursor-default grid-cols-[24px_1fr_auto] items-start gap-2 border-b border-border px-3 py-1 text-sm ${
                selected ? "bg-primary/10 outline outline-2 -outline-offset-2 outline-primary" : ""
              }`}
            >
              <span className={`pt-px text-xs font-bold ${KIND_CLASS[suggestion.kind] ?? "text-muted-foreground"}`}>
                {KIND_LABEL[suggestion.kind] ?? "•"}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1 font-medium">
                  {suggestion.isNew ? <span aria-label="new" className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /> : null}
                  {URGENCY_TAG[suggestion.urgency] ? (
                    <span
                      className={`shrink-0 rounded px-1 text-2xs font-semibold ${URGENCY_TAG[suggestion.urgency].className}`}
                    >
                      {URGENCY_TAG[suggestion.urgency].label}
                    </span>
                  ) : null}
                  <span className="truncate">{suggestion.title}</span>
                </div>
                <div className={`text-xs text-muted-foreground ${selected ? "" : "truncate"}`}>{suggestion.why}</div>
                {selected ? (
                  // Mouse path for Q / E; the keys stay the keyboard path, so the buttons skip the tab order.
                  <div className="mt-1 flex items-center gap-1.5 pb-0.5">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={(event) => {
                        event.stopPropagation();
                        onStart();
                      }}
                      title="Put this ask in the Orchestrator input; edit it, then press Enter to send"
                      className="inline-flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      Ask Orchestrator <kbd className="rounded bg-white/20 px-1 font-sans text-2xs">Q</kbd>
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDismiss();
                      }}
                      className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-0.5 text-xs hover:bg-secondary"
                    >
                      Dismiss <kbd className="rounded bg-muted px-1 font-sans text-2xs">E</kbd>
                    </button>
                  </div>
                ) : null}
              </div>
              <span className="text-xs tabular-nums text-link">{suggestion.targetLabel ?? ""}</span>
            </div>
          );
        })}
      </div>
      {hidden > 0 ? (
        <button type="button" onClick={onShowAll} className="px-3 py-1 text-xs text-link hover:underline">
          Show {hidden} more
        </button>
      ) : null}
    </div>
  );
});
