import { forwardRef, type KeyboardEvent } from "react";
import { PreviewEmptyState } from "@/components/StateDisplay";
import type { HomeSuggestion } from "@/lib/azdoCommands";

const KIND_LABEL: Record<string, string> = { pr: "PR", wi: "WI" };
const KIND_CLASS: Record<string, string> = { pr: "text-link", wi: "text-success" };

/** How many suggestions show before "Show n more" (Orca's Up next shows 3). */
export const HOME_SUGGESTIONS_SHOWN = 3;

/**
 * The brief and the suggestions, as one listbox. The selected row expands to
 * show why and what Start would ask.
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
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  }
>(function HomeSuggestionList({ brief, briefMeta, suggestions, selectedId, showAll, onShowAll, onSelect, onKeyDown }, ref) {
  const visible = showAll ? suggestions : suggestions.slice(0, HOME_SUGGESTIONS_SHOWN);
  const hidden = suggestions.length - visible.length;
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {brief.length ? (
        <section aria-label="Brief" className="border-b border-border px-3 py-1.5 text-sm">
          <h3 className="flex items-baseline gap-2 font-semibold">
            Today <span className="text-xs font-normal text-muted-foreground">{briefMeta}</span>
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
            message="Nothing needs you right now."
            hint="Change the focus in Settings, or press L to look around again."
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
                  <span className="truncate">{suggestion.title}</span>
                </div>
                <div className={`text-xs text-muted-foreground ${selected ? "" : "truncate"}`}>{suggestion.why}</div>
                {selected ? (
                  <div className="mt-0.5 rounded border-l-2 border-primary bg-info/10 px-1.5 text-xs">
                    <span className="font-semibold">Start (Q) asks: </span>
                    {suggestion.ask}
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
